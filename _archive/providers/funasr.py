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
        self.device = config.get("device", "cuda")
        self._model = None
        # chunk_size = [look_back, chunk_size, look_ahead]，单位约 60ms
        self._chunk_size = [5, 10, 5]
        self._stride_len = 960 * self._chunk_size[1]  # 主 chunk 对应的采样数
        self._is_running = False
        self._process_task: asyncio.Task | None = None
        self._audio_queue: asyncio.Queue[bytes] = asyncio.Queue()

    async def start(self) -> None:
        import torch
        from funasr import AutoModel

        device = self.device
        try:
            # 流式模式不兼容 vad_model
            self._model = AutoModel(
                model=self.model_name,
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
        # 向队列放入空 chunk 唤醒 process_loop 让它处理剩余 buffer
        try:
            self._audio_queue.put_nowait(b'')
        except asyncio.QueueFull:
            pass
        if self._process_task:
            try:
                await asyncio.wait_for(self._process_task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
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
        """从队列取音频块，累积后送入 FunASR 流式推理"""
        model = self._model  # 缓存引用，防止 stop/unload 期间被清空
        buffer = np.array([], dtype=np.float32)
        cache: dict = {}
        accumulated_text = ""

        while True:
            try:
                chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if len(chunk) == 0:
                break

            audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
            buffer = np.concatenate([buffer, audio])

            if not self._is_running:
                # 停止信号：把 buffer 剩余处理完就退出
                break

            # 累积足够音频后送入推理
            while len(buffer) >= self._stride_len:
                end = min(len(buffer), self._stride_len + 960 * (self._chunk_size[0] + self._chunk_size[2]))
                speech_chunk = buffer[:end]
                buffer = buffer[self._stride_len:]

                is_final = len(buffer) < 960 * self._chunk_size[1]

                try:
                    result = model.generate(
                        input=speech_chunk,
                        cache=cache,
                        is_final=is_final,
                        chunk_size=self._chunk_size,
                    )
                    if result and len(result) > 0:
                        text = result[0].get("text", "")
                        if text:
                            accumulated_text += text.strip()
                            self._emit(ASRResult(
                                type="partial",
                                text=accumulated_text,
                                language="zh",
                            ))
                except Exception as e:
                    logger.error(f"FunASR 推理错误: {e}")

        # 处理 buffer 中的剩余音频
        if len(buffer) > 0 and model is not None:
            try:
                result = model.generate(
                    input=buffer,
                    cache=cache,
                    is_final=True,
                    chunk_size=self._chunk_size,
                )
                if result and len(result) > 0:
                    text = result[0].get("text", "")
                    if text:
                        accumulated_text += text.strip()
            except Exception as e:
                logger.error(f"FunASR 最终推理错误: {e}")

        if accumulated_text:
            self._emit(ASRResult(type="final", text=accumulated_text, language="zh"))
