"""模型生命周期管理：按需加载、空闲卸载、OOM 降级"""
from __future__ import annotations
import asyncio
import gc
import logging
import time

from asr.providers.base import ASRProvider

logger = logging.getLogger(__name__)


def create_provider(provider: str, model_name: str, config_loader) -> ASRProvider:
    if provider == "whisper":
        from asr.providers.whisper import WhisperProvider
        return WhisperProvider(config_loader.whisper_config())
    elif provider == "funasr":
        from asr.providers.funasr import FunASRProvider
        return FunASRProvider(config_loader.funasr_config())
    else:
        raise ValueError(f"Unknown provider: {provider}")


def get_available_providers() -> list[str]:
    providers = []
    try:
        import faster_whisper
        providers.append("whisper")
    except ImportError:
        pass
    try:
        from funasr import AutoModel
        providers.append("funasr")
    except ImportError:
        pass
    return providers


class ModelManager:
    def __init__(self, idle_timeout: int = 300, config_loader=None):
        self.idle_timeout = idle_timeout
        self.config_loader = config_loader
        self._current_provider: str | None = None
        self._current_model: ASRProvider | None = None
        self._last_activity: float = 0.0
        self._lock = asyncio.Lock()
        self._shutdown = asyncio.Event()
        self._monitor_task: asyncio.Task | None = None

    async def ensure_loaded(self, provider: str, model_name: str) -> ASRProvider:
        """按需加载，如果切换 provider 则先卸载旧的。协程安全。"""
        async with self._lock:
            if self._current_provider == provider and self._current_model is not None:
                self._last_activity = time.time()
                return self._current_model
            await self._unload_internal()
            self._current_model = create_provider(provider, model_name, self.config_loader)
            await self._current_model.start()
            self._current_provider = provider
            self._last_activity = time.time()
            return self._current_model

    async def _unload_internal(self) -> None:
        if self._current_model:
            await self._current_model.stop()
            del self._current_model
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
            self._current_model = None
            self._current_provider = None

    async def unload(self) -> None:
        async with self._lock:
            await self._unload_internal()

    @property
    def is_loaded(self) -> bool:
        return self._current_model is not None

    @property
    def current_provider(self) -> str | None:
        return self._current_provider

    @property
    def idle_seconds(self) -> float:
        if self._last_activity == 0:
            return 0.0
        return time.time() - self._last_activity

    def touch(self) -> None:
        self._last_activity = time.time()

    async def process_audio(self, chunk: bytes) -> bool:
        """安全地转发音频给当前模型。协程安全。如果模型未加载则静默丢弃。"""
        async with self._lock:
            if self._current_model is None:
                return False
            await self._current_model.send_audio(chunk)
            return True

    async def start_monitor(self) -> None:
        self._monitor_task = asyncio.create_task(self._idle_monitor())

    async def _idle_monitor(self) -> None:
        while not self._shutdown.is_set():
            if self._current_model and time.time() - self._last_activity > self.idle_timeout:
                provider = self._current_provider
                logger.info(f"空闲超时({self.idle_timeout}s)，卸载 {provider}")
                await self.unload()
            await asyncio.sleep(60)

    async def shutdown(self) -> None:
        self._shutdown.set()
        await self.unload()
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
