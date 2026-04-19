"""ASR Provider 抽象基类"""
from __future__ import annotations
from abc import ABC, abstractmethod
import asyncio
from asr.protocol import ASRResult


class ASRProvider(ABC):
    def __init__(self):
        self._result_queue: asyncio.Queue[ASRResult] | None = None

    def set_result_queue(self, queue: asyncio.Queue[ASRResult]) -> None:
        self._result_queue = queue

    def _emit(self, result: ASRResult) -> None:
        if self._result_queue is not None:
            self._result_queue.put_nowait(result)

    @abstractmethod
    async def start(self) -> None:
        """初始化模型，准备接收音频"""

    @abstractmethod
    async def send_audio(self, chunk: bytes) -> None:
        """接收 16kHz 单声道 PCM 音频块"""

    @abstractmethod
    async def stop(self) -> None:
        """停止推理，释放推理资源（不释放模型）"""
