"""GGUF ASR Provider - 基于 Qwen3-ASR GGUF 的实时语音识别"""
from __future__ import annotations
import asyncio
import concurrent.futures
import logging
import numpy as np
from collections import deque
from pathlib import Path

from asr.providers.base import ASRProvider
from asr.protocol import ASRResult

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
VAD_CHUNK_SIZE = 512  # Silero VAD 输入块大小（32ms @ 16kHz）
VAD_CONTEXT_SIZE = 64  # Silero VAD context 大小


class GGUFProvider(ASRProvider):
    """GGUF Provider: Silero VAD + Qwen3-ASR GGUF Engine"""

    def __init__(self, config: dict):
        super().__init__()
        self.model_dir = config["model_dir"]
        self.llm_fn = config.get("llm_fn", "qwen3_asr_llm.q4_k.gguf")
        self.encoder_frontend_fn = config.get("encoder_frontend_fn", "qwen3_asr_encoder_frontend.int4.onnx")
        self.encoder_backend_fn = config.get("encoder_backend_fn", "qwen3_asr_encoder_backend.int4.onnx")
        self.onnx_provider = config.get("onnx_provider", "CPU")
        self.llm_use_gpu = config.get("llm_use_gpu", True)
        self.language = config.get("language", "Chinese")
        self.rollback_num = config.get("rollback_num", 5)
        self.memory_chunks = config.get("memory_chunks", 2)
        self.temperature = config.get("temperature", 0.4)
        self.n_ctx = config.get("n_ctx", 2048)
        self.verbose = config.get("verbose", False)

        # 缓冲策略
        self.max_buffer_sec = config.get("vad_max_buffer_sec", 10.0)
        self.min_buffer_sec = config.get("vad_min_buffer_sec", 0.5)
        self.vad_threshold = config.get("vad_threshold", 0.5)
        self.silence_check_ms = config.get("vad_silence_ms", 300)
        self.sentence_min_len = config.get("sentence_min_len", 5)
        self.overlap_sec = config.get("overlap_sec", 0.5)

        self._engine = None
        self._vad_session = None
        self._is_running = False
        self._process_task: asyncio.Task | None = None
        self._audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self._asr_memory: deque = deque(maxlen=self.memory_chunks)
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        self._loop = asyncio.get_event_loop()
        await self._load_engine()
        self._load_vad()
        self._is_running = True
        self._process_task = asyncio.create_task(self._process_loop())
        logger.info(f"GGUF Provider 已启动 (model_dir={self.model_dir})")

    def _load_vad(self) -> None:
        import onnxruntime as ort

        vad_path = Path(__file__).parent / "silero_vad.onnx"
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self._vad_session = ort.InferenceSession(str(vad_path), sess_options=opts)
        self._vad_state = np.zeros((2, 1, 128), dtype=np.float32)
        self._vad_context = np.zeros((1, VAD_CONTEXT_SIZE), dtype=np.float32)
        logger.info("Silero VAD 已加载")

    def _reset_vad(self) -> None:
        self._vad_state = np.zeros((2, 1, 128), dtype=np.float32)
        self._vad_context = np.zeros((1, VAD_CONTEXT_SIZE), dtype=np.float32)

    def _vad_prob(self, audio: np.ndarray) -> float:
        """返回音频块的语音概率 (0.0~1.0)，audio 长度必须为 VAD_CHUNK_SIZE"""
        chunk = audio.reshape(1, -1)
        x = np.concatenate([self._vad_context, chunk], axis=1)
        out, self._vad_state = self._vad_session.run(
            None,
            {"input": x, "state": self._vad_state, "sr": np.array(SAMPLE_RATE, dtype=np.int64)},
        )
        self._vad_context = chunk[:, -VAD_CONTEXT_SIZE:]
        return float(out[0][0])

    async def _load_engine(self) -> None:
        from .qwen_asr_gguf.inference.schema import ASREngineConfig
        from .qwen_asr_gguf.inference.asr import QwenASREngine

        engine_config = ASREngineConfig(
            model_dir=self.model_dir,
            encoder_frontend_fn=self.encoder_frontend_fn,
            encoder_backend_fn=self.encoder_backend_fn,
            llm_fn=self.llm_fn,
            onnx_provider=self.onnx_provider,
            llm_use_gpu=self.llm_use_gpu,
            n_ctx=self.n_ctx,
            verbose=self.verbose,
            enable_aligner=False,
        )

        try:
            self._engine = QwenASREngine(engine_config)
            logger.info("GGUF ASR 引擎已加载")
        except Exception as e:
            if "out of memory" in str(e).lower() and self.llm_use_gpu:
                logger.warning("GPU 显存不足，切换到 CPU 模式")
                engine_config.llm_use_gpu = False
                self._engine = QwenASREngine(engine_config)
                self.llm_use_gpu = False
            else:
                raise

    async def stop(self) -> None:
        self._is_running = False
        try:
            self._audio_queue.put_nowait(b"")
        except asyncio.QueueFull:
            pass

        if self._process_task:
            try:
                await asyncio.wait_for(self._process_task, timeout=30.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._process_task.cancel()
                try:
                    await self._process_task
                except asyncio.CancelledError:
                    pass
            self._process_task = None

        if self._engine:
            self._engine.shutdown()
            self._engine = None

        self._thread_pool.shutdown(wait=False)
        self._asr_memory.clear()
        logger.info("GGUF Provider 已停止")

    async def send_audio(self, chunk: bytes) -> None:
        await self._audio_queue.put(chunk)

    async def _process_loop(self) -> None:
        buffer = np.array([], dtype=np.float32)
        max_buffer_samples = int(self.max_buffer_sec * SAMPLE_RATE)
        min_buffer_samples = int(self.min_buffer_sec * SAMPLE_RATE)
        silence_frames = int(self.silence_check_ms / 32)

        self._reset_vad()
        consecutive_silence = 0

        while self._is_running:
            try:
                chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue

            if len(chunk) == 0:
                break

            audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

            # 前置静音过滤（使用独立 state，不影响主 VAD 分段逻辑）
            if len(buffer) == 0 and len(audio) >= VAD_CHUNK_SIZE:
                aligned = audio[:(len(audio) // VAD_CHUNK_SIZE) * VAD_CHUNK_SIZE]
                temp_state = np.zeros((2, 1, 128), dtype=np.float32)
                temp_context = np.zeros((1, VAD_CONTEXT_SIZE), dtype=np.float32)
                all_silence = True
                for i in range(0, len(aligned), VAD_CHUNK_SIZE):
                    chunk_vad = aligned[i:i + VAD_CHUNK_SIZE].reshape(1, -1)
                    x = np.concatenate([temp_context, chunk_vad], axis=1)
                    out, temp_state = self._vad_session.run(
                        None,
                        {"input": x, "state": temp_state, "sr": np.array(SAMPLE_RATE, dtype=np.int64)},
                    )
                    temp_context = chunk_vad[:, -VAD_CONTEXT_SIZE:]
                    if float(out[0][0]) >= self.vad_threshold:
                        all_silence = False
                        break
                if all_silence:
                    continue

            buffer = np.concatenate([buffer, audio])
            buffer_len = len(buffer)

            should_transcribe = False

            if buffer_len >= max_buffer_samples:
                # 长缓冲：扫描最后 2 秒找静音间隙，找不到则强制截断
                scan_window = min(buffer_len, 2 * SAMPLE_RATE)
                gap_end = self._find_last_silence_gap(buffer[-scan_window:])
                if gap_end is not None:
                    split = buffer_len - scan_window + gap_end
                    segment = buffer[:split].copy()
                    buffer = buffer[split:].copy()
                else:
                    overlap_samples = int(self.overlap_sec * SAMPLE_RATE)
                    segment = buffer.copy()
                    buffer = buffer[-overlap_samples:].copy() if overlap_samples > 0 else np.array([], dtype=np.float32)
                should_transcribe = True
            elif buffer_len >= min_buffer_samples:
                tail = buffer[-silence_frames * VAD_CHUNK_SIZE:]
                if len(tail) >= VAD_CHUNK_SIZE:
                    aligned_len = (len(tail) // VAD_CHUNK_SIZE) * VAD_CHUNK_SIZE
                    tail_aligned = tail[:aligned_len]
                    is_silence = True
                    for i in range(0, len(tail_aligned), VAD_CHUNK_SIZE):
                        prob = self._vad_prob(tail_aligned[i:i + VAD_CHUNK_SIZE])
                        if prob >= self.vad_threshold:
                            is_silence = False
                            consecutive_silence = 0
                            break
                    if is_silence:
                        consecutive_silence += 1
                        if consecutive_silence >= 2:
                            segment = buffer.copy()
                            buffer = np.array([], dtype=np.float32)
                            should_transcribe = True

            if should_transcribe:
                logger.info(f"转录 {buffer_len/SAMPLE_RATE:.1f}s 音频")
                consecutive_silence = 0
                self._reset_vad()
                await self._transcribe_segment(segment)

        if len(buffer) > 0:
            logger.info(f"处理剩余 {len(buffer)/SAMPLE_RATE:.1f}s 音频")
            await self._transcribe_segment(buffer)

    def _find_last_silence_gap(self, audio: np.ndarray) -> int | None:
        """扫描音频，找到最后一个静音间隙的结束位置（样本偏移量）。
        静音间隙定义：连续 >= 200ms 的帧概率低于阈值。返回 None 表示没有找到。"""
        min_gap_frames = max(int(200 / 32), 3)  # 至少 200ms
        aligned_len = (len(audio) // VAD_CHUNK_SIZE) * VAD_CHUNK_SIZE
        if aligned_len == 0:
            return None

        # 临时用独立 state 计算概率，不影响主 VAD state
        import copy
        state = np.zeros((2, 1, 128), dtype=np.float32)
        context = np.zeros((1, VAD_CONTEXT_SIZE), dtype=np.float32)

        probs = []
        for i in range(0, aligned_len, VAD_CHUNK_SIZE):
            chunk = audio[i:i + VAD_CHUNK_SIZE].reshape(1, -1)
            x = np.concatenate([context, chunk], axis=1)
            out, state = self._vad_session.run(
                None,
                {"input": x, "state": state, "sr": np.array(SAMPLE_RATE, dtype=np.int64)},
            )
            context = chunk[:, -VAD_CONTEXT_SIZE:]
            probs.append(float(out[0][0]))

        # 从后往前找连续静音区域
        silence_count = 0
        for i in range(len(probs) - 1, -1, -1):
            if probs[i] < self.vad_threshold:
                silence_count += 1
                if silence_count >= min_gap_frames:
                    # 返回静音区域的结束位置（样本偏移量）
                    return (i + 1) * VAD_CHUNK_SIZE
            else:
                silence_count = 0

        return None

    async def _transcribe_segment(self, segment: np.ndarray) -> None:
        if self._engine is None or self._loop is None:
            return

        min_samples = SAMPLE_RATE
        if len(segment) < min_samples:
            segment = np.pad(segment, (0, min_samples - len(segment)))

        provider = self
        partial_text: list[str] = []

        def _on_token(piece: str) -> None:
            partial_text.append(piece)
            result = ASRResult(type="partial", text="".join(partial_text), language="zh")
            provider._loop.call_soon_threadsafe(provider._result_queue.put_nowait, result)

        def _run_blocking():
            engine = self._engine

            audio_feature, _ = engine.encoder.encode(segment)
            prefix_text = "".join([m[1] for m in self._asr_memory])
            combined_audio = np.concatenate(
                [m[0] for m in self._asr_memory] + [audio_feature], axis=0
            )
            full_embd = engine._build_prompt_embd(
                combined_audio, prefix_text, None, self.language
            )

            result = engine._safe_decode(
                full_embd, prefix_text, self.rollback_num,
                is_last_chunk=True, temperature=self.temperature,
                streaming=True, on_token=_on_token
            )
            return (audio_feature, result.text)

        try:
            audio_feature, text = await self._loop.run_in_executor(
                self._thread_pool, _run_blocking
            )
            self._asr_memory.append((audio_feature, text))
            if text.strip():
                self._emit(ASRResult(type="final", text=text, language="zh"))
        except Exception as e:
            logger.error(f"GGUF 推理错误: {e}")
