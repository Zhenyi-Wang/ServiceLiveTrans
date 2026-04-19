"""FunASR ASR Provider（流式）"""
from __future__ import annotations
import asyncio
import logging
import numpy as np
from asr.providers.base import ASRProvider
from asr.protocol import ASRResult

logger = logging.getLogger(__name__)


class FunASRProvider(ASRProvider):
    def __init__(self, config: dict):
        super().__init__()
        self.model_name = config["model"]
        self.vad_model = config.get("vad_model", "fsmn-vad")
        self.device = config.get("device", "cuda")
        self._model = None
        self._chunk_size = int(960 * 1)  # ~60ms chunks for streaming
        self._is_running = False
        self._process_task: asyncio.Task | None = None
        self._audio_queue: asyncio.Queue[bytes] = asyncio.Queue()

    async def start(self) -> None:
        import torch
        from funasr import AutoModel

        device = self.device
        try:
            self._model = AutoModel(
                model=self.model_name,
                vad_model=self.vad_model,
                device=device,
                disable_update=True,
                trust_remote_code=True,
            )
            logger.info(f"FunASR 模型加载成功: {self.model_name}, device={device}")
        except Exception as e:
            if "out of memory" in str(e).lower() and device == "cuda":
                logger.warning("GPU 显存不足，切换到 CPU 模式")
                torch.cuda.empty_cache()
                self._model = AutoModel(
                    model=self.model_name,
                    vad_model=self.vad_model,
                    device="cpu",
                    disable_update=True,
                    trust_remote_code=True,
                )
                self.device = "cpu"
                logger.info("FunASR CPU 模式加载成功")
            else:
                raise

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
        """接收 16kHz 16bit mono PCM，放入队列"""
        await self._audio_queue.put(chunk)

    async def _process_loop(self) -> None:
        """从队列取音频块，送入 FunASR 流式推理"""
        cache = {}
        while self._is_running:
            try:
                chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

            try:
                result = self._model.generate(
                    input=audio,
                    cache=cache,
                    is_final=False,
                    chunk_size=self._chunk_size,
                )
                if result and len(result) > 0:
                    text = result[0].get("text", "")
                    if text:
                        is_final = text.endswith(("。", ".", "！", "!", "？", "?"))
                        self._emit(ASRResult(
                            type="final" if is_final else "partial",
                            text=text.strip(),
                            language="zh",
                        ))
            except Exception as e:
                logger.error(f"FunASR 推理错误: {e}")
