"""faster-whisper ASR Provider"""
from __future__ import annotations
import asyncio
import logging
import numpy as np
from asr.providers.base import ASRProvider
from asr.protocol import ASRResult

logger = logging.getLogger(__name__)


class WhisperProvider(ASRProvider):
    def __init__(self, config: dict):
        super().__init__()
        self.model_path = config["model"]
        self.device = config.get("device", "cuda")
        self.compute_type = config.get("compute_type", "int8")
        self.local_files_only = config.get("local_files_only", True)
        self.vad_filter = config.get("vad_filter", True)
        self.vad_parameters = config.get("vad_parameters", {"threshold": 0.5})
        self.initial_prompt = "基督。"

        self._model = None
        self._buffer = np.array([], dtype=np.float32)
        self._buffer_lock = asyncio.Lock()
        self._is_running = False
        self._process_task: asyncio.Task | None = None

    async def start(self) -> None:
        import torch
        from faster_whisper import WhisperModel

        device = self.device
        try:
            self._model = WhisperModel(
                self.model_path,
                device=device,
                compute_type=self.compute_type,
                local_files_only=self.local_files_only,
            )
            logger.info(f"Whisper 模型加载成功: {self.model_path}, device={device}")
        except Exception as e:
            if "out of memory" in str(e).lower() and device == "cuda":
                logger.warning("GPU 显存不足，切换到 CPU 模式")
                torch.cuda.empty_cache()
                self._model = WhisperModel(
                    self.model_path,
                    device="cpu",
                    compute_type="int8",
                    local_files_only=self.local_files_only,
                )
                self.device = "cpu"
                logger.info("Whisper CPU 模式加载成功")
            else:
                raise

        self._buffer = np.array([], dtype=np.float32)
        self._is_running = True
        self._process_task = asyncio.create_task(self._process_loop())

    async def stop(self) -> None:
        self._is_running = False
        if self._process_task:
            self._process_task.cancel()
            try:
                await self._process_task
            except asyncio.CancelledError:
                pass
            self._process_task = None
        self._model = None

    async def send_audio(self, chunk: bytes) -> None:
        """接收 16kHz 16bit mono PCM，追加到缓冲区"""
        audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        async with self._buffer_lock:
            self._buffer = np.concatenate([self._buffer, audio])

    async def _process_loop(self) -> None:
        """持续检查缓冲区，达到最小阈值或静音时触发推理"""
        MIN_CHUNK_DURATION = 1.0  # 最小 1s
        MAX_CHUNK_DURATION = 5.0  # 最大 5s（防止过长延迟）
        SAMPLE_RATE = 16000
        min_samples = int(MIN_CHUNK_DURATION * SAMPLE_RATE)
        max_samples = int(MAX_CHUNK_DURATION * SAMPLE_RATE)

        while self._is_running:
            await asyncio.sleep(0.2)

            async with self._buffer_lock:
                buf_len = len(self._buffer)

                should_transcribe = False
                if buf_len == 0:
                    continue
                elif buf_len >= max_samples:
                    should_transcribe = True
                elif buf_len >= min_samples:
                    # 检查是否有静音（尾部 0.3s 均值接近 0）
                    tail_duration = 0.3
                    tail_samples = int(tail_duration * SAMPLE_RATE)
                    if buf_len >= tail_samples:
                        tail = self._buffer[-tail_samples:]
                        rms = np.sqrt(np.mean(tail ** 2))
                        if rms < 0.01:  # 静音阈值
                            should_transcribe = True

                if should_transcribe:
                    audio_data = self._buffer.copy()
                    self._buffer = np.array([], dtype=np.float32)
                else:
                    continue

            await self._transcribe_chunk(audio_data)

    async def _transcribe_chunk(self, audio: np.ndarray) -> None:
        """对音频块做推理，先发 partial 再发 final"""
        if self._model is None:
            return

        # partial：直接推理当前块
        partial_text = ""
        try:
            segments, info = self._model.transcribe(
                audio,
                language="zh",
                beam_size=3,
                vad_filter=False,
                condition_on_previous_text=False,
            )
            for seg in segments:
                partial_text += seg.text
            if partial_text:
                self._emit(ASRResult(type="partial", text=partial_text, language=info.language))
        except Exception as e:
            logger.error(f"Whisper 推理错误: {e}")
            return

        # final：VAD 过滤后重新推理（更准确）
        try:
            segments, info = self._model.transcribe(
                audio,
                language="zh",
                beam_size=5,
                vad_filter=self.vad_filter,
                vad_parameters=self.vad_parameters,
                initial_prompt=self.initial_prompt,
            )
            final_text = "".join(seg.text for seg in segments)
            if final_text.strip():
                self._emit(ASRResult(type="final", text=final_text.strip(), language=info.language))
        except Exception as e:
            logger.error(f"Whisper final 推理错误: {e}")
