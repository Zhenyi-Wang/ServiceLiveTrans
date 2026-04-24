"""GGUF ASR Provider - 基于 Qwen3-ASR GGUF 的实时语音识别"""
from __future__ import annotations
import asyncio
import concurrent.futures
import logging
import os
import numpy as np
from collections import deque
from pathlib import Path

from asr.providers.base import ASRProvider
from asr.protocol import ASRResult

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000


class GGUFProvider(ASRProvider):
    """GGUF Provider: RMS 能量检测 + Qwen3-ASR GGUF Engine"""

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
        self.min_buffer_sec = config.get("vad_min_buffer_sec", 0.5)  # 降低最小缓冲
        self.silence_rms = config.get("vad_threshold", 0.005)  # 降低阈值
        self.silence_check_ms = config.get("vad_silence_ms", 500)
        self.sentence_min_len = config.get("sentence_min_len", 5)

        self._engine = None
        self._is_running = False
        self._process_task: asyncio.Task | None = None
        self._audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self._asr_memory: deque = deque(maxlen=self.memory_chunks)
        self._chunk_text_acc = ""
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        self._loop = asyncio.get_event_loop()
        await self._load_engine()
        self._is_running = True
        self._process_task = asyncio.create_task(self._process_loop())
        logger.info(f"GGUF Provider 已启动 (model_dir={self.model_dir})")

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
                # 等待更长时间让推理完成
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

    def _is_silence(self, audio: np.ndarray) -> bool:
        """RMS 能量检测静音"""
        rms = np.sqrt(np.mean(audio ** 2))
        return rms < self.silence_rms

    async def _process_loop(self) -> None:
        buffer = np.array([], dtype=np.float32)
        silence_samples = int(self.silence_check_ms / 1000 * SAMPLE_RATE)
        max_buffer_samples = int(self.max_buffer_sec * SAMPLE_RATE)
        min_buffer_samples = int(self.min_buffer_sec * SAMPLE_RATE)

        while self._is_running:
            try:
                chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue

            if len(chunk) == 0:
                break

            audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
            buffer = np.concatenate([buffer, audio])
            buffer_len = len(buffer)

            should_transcribe = False

            if buffer_len >= max_buffer_samples:
                segment = buffer.copy()
                buffer = np.array([], dtype=np.float32)
                should_transcribe = True
            elif buffer_len >= min_buffer_samples and buffer_len >= silence_samples:
                tail = buffer[-silence_samples:]
                if self._is_silence(tail):
                    segment = buffer.copy()
                    buffer = np.array([], dtype=np.float32)
                    should_transcribe = True

            if should_transcribe:
                logger.info(f"转录 {buffer_len/SAMPLE_RATE:.1f}s 音频")
                await self._transcribe_segment(segment)

        if len(buffer) > 0:
            logger.info(f"处理剩余 {len(buffer)/SAMPLE_RATE:.1f}s 音频")
            await self._transcribe_segment(buffer)

    async def _transcribe_segment(self, segment: np.ndarray) -> None:
        if self._engine is None or self._loop is None:
            return

        min_samples = SAMPLE_RATE
        if len(segment) < min_samples:
            segment = np.pad(segment, (0, min_samples - len(segment)))

        self._chunk_text_acc = ""

        def _run_blocking():
            engine = self._engine
            loop = self._loop

            audio_feature, _ = engine.encoder.encode(segment)
            prefix_text = "".join([m[1] for m in self._asr_memory])
            combined_audio = np.concatenate(
                [m[0] for m in self._asr_memory] + [audio_feature], axis=0
            )
            full_embd = engine._build_prompt_embd(
                combined_audio, prefix_text, None, self.language
            )

            def on_token(piece: str):
                if loop is not None:
                    asyncio.run_coroutine_threadsafe(
                        self._emit_token(piece), loop
                    )

            result = engine._safe_decode(
                full_embd, prefix_text, self.rollback_num,
                is_last_chunk=True, temperature=self.temperature,
                streaming=False, on_token=on_token
            )
            return (audio_feature, result.text)

        try:
            audio_feature, text = await self._loop.run_in_executor(
                self._thread_pool, _run_blocking
            )
            self._asr_memory.append((audio_feature, text))
            # 推理结束，flush 剩余未确认的文本
            if self._chunk_text_acc.strip():
                self._emit(ASRResult(type="final", text=self._chunk_text_acc, language="zh"))
        except Exception as e:
            logger.error(f"GGUF 推理错误: {e}")

    async def _emit_token(self, piece: str) -> None:
        self._chunk_text_acc += piece

        # 检测句末标点，满足长度阈值时 flush 为 final
        sentence_end_punct = set("。！？；…")
        if piece and piece[-1] in sentence_end_punct:
            text_no_punct = self._chunk_text_acc.rstrip("。！？；…，、：")
            if len(text_no_punct) >= self.sentence_min_len:
                self._emit(ASRResult(type="final", text=self._chunk_text_acc, language="zh"))
                self._chunk_text_acc = ""
                return

        self._emit(ASRResult(type="partial", text=self._chunk_text_acc, language="zh"))
