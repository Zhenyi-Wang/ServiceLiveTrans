# ASR 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入真实 ASR 后端（faster-whisper + FunASR），替代模拟器实现实时语音转录。

**Architecture:** Python ASR 进程独立运行，通过 WebSocket 与 Nuxt 服务通信。Nuxt 作为中间层负责协议转换和状态管理。前端通过 WebSocket 发送音频并接收字幕。两个 ASR provider 通过统一接口抽象，模型按需加载、空闲自动卸载。

**Tech Stack:** Python 3.10 (asyncio + websockets), faster-whisper, FunASR, Nuxt 4 (Nitro WebSocket), AudioWorklet API

**Design spec:** `docs/superpowers/specs/2026-04-19-asr-integration-design.md`

---

## 文件结构

### Python ASR 进程（新建）

| 文件 | 职责 |
|------|------|
| `asr/server.py` | WebSocket 服务入口，消息路由，连接管理 |
| `asr/protocol.py` | 消息类型定义（dataclass），序列化/反序列化 |
| `asr/model_manager.py` | 模型按需加载/卸载，空闲超时，OOM 降级 |
| `asr/providers/base.py` | ASRProvider 抽象基类，ASRResult 类型 |
| `asr/providers/whisper.py` | faster-whisper 实现（VAD + 滑动窗口分块） |
| `asr/providers/funasr.py` | FunASR 流式实现 |
| `asr/config.py` | 从 config.yaml 读取配置 |
| `asr/config.yaml` | 默认配置文件 |

### Nuxt 端（新增/修改）

| 文件 | 职责 | 操作 |
|------|------|------|
| `types/transcription.ts` | TranscriptionState 统一转录状态 | 新建 |
| `server/utils/transcription-state.ts` | 全局转录状态单例 | 新建 |
| `server/utils/asr-bridge.ts` | Nuxt ↔ Python ASR WS 桥接 | 新建 |
| `server/routes/api/asr/start.ts` | 启动 ASR 会话 | 新建 |
| `server/routes/api/asr/stop.ts` | 停止 ASR 会话 | 新建 |
| `server/routes/api/asr/status.ts` | ASR 状态查询 | 新建 |
| `server/routes/api/stream/start.ts` | 启动直播流拉取（ffmpeg） | 新建 |
| `server/routes/api/stream/stop.ts` | 停止直播流拉取 | 新建 |
| `composables/useAudioCapture.ts` | AudioWorklet 音频采集 + 降采样 | 新建 |
| `composables/useWebSocket.ts` | 扩展支持音频上行 | 修改 |
| `server/routes/api/ws.ts` | init 消息改为从 TranscriptionState 读取 | 修改 |
| `server/utils/simulator.ts` | 写入 TranscriptionState | 修改 |
| `server/routes/api/status.ts` | 返回统一状态 | 修改 |
| `components/admin/ASRControlPanel.vue` | ASR 控制面板 | 新建 |
| `components/admin/ModelStatusPanel.vue` | 模型状态显示 | 新建 |
| `pages/admin.vue` | 集成 ASR 面板 | 修改 |

---

## Task 1: Python 基础设施 — 消息协议与配置

**Files:**
- Create: `asr/__init__.py`
- Create: `asr/protocol.py`
- Create: `asr/config.py`
- Create: `asr/config.yaml`
- Run: `pnpm add ws && pnpm add -D @types/ws`

- [ ] **Step 0: 安装 ws npm 包（Nuxt 作为客户端连接 Python 需要此依赖）**

```bash
pnpm add ws && pnpm add -D @types/ws
```

- [ ] **Step 1: 创建 asr 目录和 __init__.py，确保 .gitignore 包含 __pycache__**

检查 `.gitignore` 是否已有 `__pycache__/` 规则，如果没有则添加。

```bash
mkdir -p asr/providers
touch asr/__init__.py
touch asr/providers/__init__.py
grep -q '__pycache__' .gitignore || echo '__pycache__/' >> .gitignore
```

```bash
mkdir -p asr/providers
touch asr/__init__.py
touch asr/providers/__init__.py
```

- [ ] **Step 2: 创建 protocol.py — 消息类型定义**

```python
"""WebSocket 消息协议定义"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal


class MessageType(str, Enum):
    # Nuxt → Python
    CONFIG = "config"
    AUDIO = "audio"
    MODEL_LOAD = "model/load"
    MODEL_UNLOAD = "model/unload"
    MODEL_STATUS = "model/status"
    # Python → Nuxt
    PARTIAL = "partial"
    FINAL = "final"
    ERROR = "error"
    LOADING = "loading"
    READY = "ready"
    UNLOADED = "unloaded"
    MODEL_STATUS_RESP = "model/status"


@dataclass
class ASRResult:
    type: Literal["partial", "final"]
    text: str
    language: str  # "zh" | "en"


# --- Nuxt → Python ---

@dataclass
class ConfigMessage:
    type: Literal["config"] = "config"
    provider: str = ""
    model: str = ""


@dataclass
class AudioMessage:
    type: Literal["audio"] = "audio"
    data: str = ""  # base64 PCM


@dataclass
class ModelLoadMessage:
    type: Literal["model/load"] = "model/load"
    provider: str = ""


@dataclass
class ModelUnloadMessage:
    type: Literal["model/unload"] = "model/unload"


@dataclass
class ModelStatusMessage:
    type: Literal["model/status"] = "model/status"


# --- Python → Nuxt ---

@dataclass
class PartialResult:
    type: Literal["partial"] = "partial"
    text: str = ""
    language: str = "zh"


@dataclass
class FinalResult:
    type: Literal["final"] = "final"
    text: str = ""
    language: str = "zh"


@dataclass
class ErrorMessage:
    type: Literal["error"] = "error"
    message: str = ""


@dataclass
class LoadingEvent:
    type: Literal["loading"] = "loading"


@dataclass
class ReadyEvent:
    type: Literal["ready"] = "ready"


@dataclass
class UnloadedEvent:
    type: Literal["unloaded"] = "unloaded"


@dataclass
class ModelStatusResponse:
    type: Literal["model/status"] = "model/status"
    loaded: bool = False
    provider: str = ""
    gpu_used_mb: int = 0
    idle_seconds: float = 0.0


import json
import base64
from dataclasses import asdict


def decode_message(raw: str) -> dict:
    """解析客户端发来的 JSON 消息"""
    return json.loads(raw)


def encode_message(msg) -> str:
    """将 dataclass 消息编码为 JSON"""
    return json.dumps(asdict(msg))
```

- [ ] **Step 3: 创建 config.yaml**

```yaml
server:
  host: "0.0.0.0"
  port: 9900
  idle_timeout: 300
  check_interval: 60

whisper:
  # 模型路径支持 $WHISPER_MODEL_PATH 环境变量覆盖（在 config.py 中处理）
  model: "../livetrans/whisperlive/models/faster-whisper-large-v3"
  device: "cuda"
  compute_type: "int8"
  local_files_only: true
  vad_filter: true
  vad_parameters:
    threshold: 0.5

funasr:
  model: "paraformer-zh-streaming"
  vad_model: "fsmn-vad"
  device: "cuda"
```

- [ ] **Step 4: 创建 config.py**

```python
"""配置加载"""
from __future__ import annotations
import os
from pathlib import Path
import yaml


class ASRConfig:
    def __init__(self, config_path: str | None = None):
        if config_path is None:
            config_path = Path(__file__).parent / "config.yaml"
        with open(config_path) as f:
            self._raw = yaml.safe_load(f)

    @property
    def server_host(self) -> str:
        return self._raw["server"]["host"]

    @property
    def server_port(self) -> int:
        return self._raw["server"]["port"]

    @property
    def idle_timeout(self) -> int:
        return self._raw["server"]["idle_timeout"]

    @property
    def check_interval(self) -> int:
        return self._raw["server"]["check_interval"]

    def whisper_config(self) -> dict:
        cfg = dict(self._raw["whisper"])
        model = cfg.get("model", "")
        env_model = os.environ.get("WHISPER_MODEL_PATH")
        if env_model:
            model = env_model
        cfg["model"] = model
        return cfg

    def funasr_config(self) -> dict:
        return dict(self._raw["funasr"])
```

- [ ] **Step 5: 提交**

```bash
git add asr/
git commit -m "feat: 添加 Python ASR 基础设施（协议定义、配置加载）"
```

---

## Task 2: Python ASRProvider 基类

**Files:**
- Create: `asr/providers/base.py`

- [ ] **Step 1: 创建 ASRProvider 抽象基类**

```python
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
```

- [ ] **Step 2: 提交**

```bash
git add asr/providers/base.py
git commit -m "feat: 添加 ASRProvider 抽象基类"
```

---

## Task 3: Python Whisper Provider

**Files:**
- Create: `asr/providers/whisper.py"

参考: `../livetrans/whisperlive/whisper_live/transcriber.py` (WhisperModel 用法)、`../livetrans/whisperlive/whisper_live/vad.py` (Silero VAD)

- [ ] **Step 1: 创建 whisper.py**

```python
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
        SILENCE_TIMEOUT = 0.8    # 静音 0.8s 触发推理
        min_samples = int(MIN_CHUNK_DURATION * SAMPLE_RATE)
        max_samples = int(MAX_CHUNK_DURATION * SAMPLE_RATE)

        last_audio_time = 0.0

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
                vad_filter=False,  # 已在外部累积足够长度
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
```

- [ ] **Step 2: 提交**

```bash
git add asr/providers/whisper.py
git commit -m "feat: 实现 Whisper ASR Provider"
```

---

## Task 4: Python FunASR Provider

**Files:**
- Create: `asr/providers/funasr.py`

参考: `../transcribe-service/server.py` (FunASR AutoModel 用法)、`../transcribe-service/transcribe.py` (generate 调用)

- [ ] **Step 1: 创建 funasr.py**

```python
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
                        # 检测是否是句尾（FunASR 流式返回的文本带句号表示句尾）
                        is_final = text.endswith(("。", ".", "！", "!", "？", "?"))
                        self._emit(ASRResult(
                            type="final" if is_final else "partial",
                            text=text.strip(),
                            language="zh",
                        ))
            except Exception as e:
                logger.error(f"FunASR 推理错误: {e}")
```

- [ ] **Step 2: 提交**

```bash
git add asr/providers/funasr.py
git commit -m "feat: 实现 FunASR ASR Provider"
```

---

## Task 5: Python ModelManager

**Files:**
- Create: `asr/model_manager.py`

参考: `../transcribe-service/server.py` 的 ModelManager (懒加载、OOM 降级、空闲卸载)

- [ ] **Step 1: 创建 model_manager.py**

```python
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
```

- [ ] **Step 2: 提交**

```bash
git add asr/model_manager.py
git commit -m "feat: 实现模型生命周期管理器"
```

---

## Task 6: Python WebSocket 服务端

**Files:**
- Create: `asr/server.py`

- [ ] **Step 1: 创建 server.py**

```python
"""ASR WebSocket 服务入口"""
from __future__ import annotations
import asyncio
import base64
import json
import logging
import signal
import sys

import websockets
from websockets.server import serve

from asr.config import ASRConfig
from asr.model_manager import ModelManager, get_available_providers
from asr.protocol import (
    ASRResult,
    ConfigMessage,
    encode_message,
    ErrorMessage,
    LoadingEvent,
    ModelStatusResponse,
    ReadyEvent,
    UnloadedEvent,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

config = ASRConfig()
manager: ModelManager | None = None
result_queue: asyncio.Queue[ASRResult] = asyncio.Queue()
current_ws = None


async def handle_connection(websocket):
    global current_ws
    current_ws = websocket
    logger.info(f"客户端连接: {websocket.remote_address}")

    available = get_available_providers()
    await websocket.send(encode_message({
        "type": "ready",
        "available_providers": available,
    }))

    try:
        async for raw_message in websocket:
            try:
                msg = json.loads(raw_message)
                msg_type = msg.get("type", "")

                if msg_type == "config":
                    await handle_config(websocket, msg)
                elif msg_type == "audio":
                    await handle_audio(msg)
                elif msg_type == "model/load":
                    await handle_model_load(websocket, msg)
                elif msg_type == "model/unload":
                    await handle_model_unload(websocket)
                elif msg_type == "model/status":
                    await handle_model_status(websocket)
                else:
                    await websocket.send(encode_message(ErrorMessage(message=f"Unknown message type: {msg_type}")))
            except json.JSONDecodeError:
                await websocket.send(encode_message(ErrorMessage(message="Invalid JSON")))
            except Exception as e:
                logger.error(f"消息处理错误: {e}")
                await websocket.send(encode_message(ErrorMessage(message=str(e))))
    except websockets.ConnectionClosed:
        pass
    finally:
        current_ws = None
        # 清空 queue 中未消费的结果，防止堆积
        while not result_queue.empty():
            try:
                result_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        logger.info("客户端断开")


async def handle_config(websocket, msg: dict):
    provider = msg.get("provider", "")
    model = msg.get("model", "")
    if not provider:
        await websocket.send(encode_message(ErrorMessage(message="Missing provider")))
        return

    await websocket.send(encode_message(LoadingEvent()))
    try:
        model_inst = await manager.ensure_loaded(provider, model)
        model_inst.set_result_queue(result_queue)
        await websocket.send(encode_message(ReadyEvent()))
        logger.info(f"Provider 就绪: {provider}")
    except Exception as e:
        logger.error(f"模型加载失败: {e}")
        await websocket.send(encode_message(ErrorMessage(message=f"Model load failed: {e}")))


async def handle_audio(msg: dict):
    data_b64 = msg.get("data", "")
    if not data_b64:
        return
    chunk = base64.b64decode(data_b64)

    manager.touch()
    await manager.process_audio(chunk)


async def handle_model_load(websocket, msg: dict):
    provider = msg.get("provider", "")
    await handle_config(websocket, {"provider": provider, "model": ""})


async def handle_model_unload(websocket):
    await manager.unload()
    await websocket.send(encode_message(UnloadedEvent()))


async def handle_model_status(websocket):
    import torch
    gpu_used = 0
    if torch.cuda.is_available():
        gpu_used = torch.cuda.memory_allocated() // (1024 * 1024)
    await websocket.send(encode_message(ModelStatusResponse(
        loaded=manager.is_loaded,
        provider=manager.current_provider or "",
        gpu_used_mb=gpu_used,
        idle_seconds=manager.idle_seconds,
    )))


async def result_forwarder(websocket):
    """从 result_queue 读取结果并转发给客户端"""
    try:
        while True:
            result = await result_queue.get()
            if result.type == "partial":
                msg = {"type": "partial", "text": result.text, "language": result.language}
            else:
                msg = {"type": "final", "text": result.text, "language": result.language}
            await websocket.send(json.dumps(msg))
    except websockets.ConnectionClosed:
        pass
    except asyncio.CancelledError:
        pass


async def main():
    global manager
    manager = ModelManager(idle_timeout=config.idle_timeout, config_loader=config)
    await manager.start_monitor()

    available = get_available_providers()
    logger.info(f"可用 Provider: {available}")

    async def handler(websocket):
        forward_task = asyncio.create_task(result_forwarder(websocket))
        try:
            await handle_connection(websocket)
        finally:
            forward_task.cancel()

    loop = asyncio.get_event_loop()
    stop = loop.create_future()

    def _signal_handler():
        if not stop.done():
            stop.set_result(None)

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _signal_handler)

    logger.info(f"ASR 服务启动: ws://{config.server_host}:{config.server_port}")
    async with serve(handler, config.server_host, config.server_port):
        await stop

    logger.info("正在关闭...")
    await manager.shutdown()
    logger.info("ASR 服务已停止")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: 验证 Python 服务能启动（无模型时）**

```bash
conda run -n trans python -c "from asr.server import main; print('import ok')"
```

预期输出: `import ok`

- [ ] **Step 3: 提交**

```bash
git add asr/server.py
git commit -m "feat: 实现 ASR WebSocket 服务端"
```

---

## Task 7: Nuxt 统一转录状态

**Files:**
- Create: `types/transcription.ts`
- Create: `server/utils/transcription-state.ts`
- Modify: `server/routes/api/ws.ts` — init 消息从 TranscriptionState 读取
- Modify: `server/utils/simulator.ts` — 写入 TranscriptionState
- Modify: `server/routes/api/status.ts` — 返回统一状态

- [ ] **Step 1: 创建 types/transcription.ts**

```typescript
import type { CurrentSubtitle, ConfirmedSubtitle } from './subtitle'

export interface TranscriptionState {
  isActive: boolean
  source: 'simulator' | 'asr' | null
  currentSubtitle: CurrentSubtitle | null
  confirmedSubtitles: ConfirmedSubtitle[]
}
```

- [ ] **Step 2: 创建 server/utils/transcription-state.ts**

```typescript
import type { TranscriptionState } from '../../types/transcription'

export const transcriptionState: TranscriptionState = {
  isActive: false,
  source: null,
  currentSubtitle: null,
  confirmedSubtitles: []
}
```

- [ ] **Step 3: 修改 server/routes/api/ws.ts — init 从统一状态读取**

将文件内容替换为：

```typescript
import type { WSMessage } from '../../../types/websocket'
import { addConnection, removeConnection, sendTo } from '../../utils/websocket'
import { transcriptionState } from '../../utils/transcription-state'

export default defineWebSocketHandler({
  open(peer) {
    addConnection(peer)
    console.log(`WebSocket connected: ${peer}`)

    const initMessage: WSMessage = {
      type: 'init',
      data: {
        current: transcriptionState.currentSubtitle?.text ?? null,
        confirmed: transcriptionState.confirmedSubtitles
      }
    }
    sendTo(peer, initMessage)
  },

  close(peer) {
    removeConnection(peer)
    console.log(`WebSocket disconnected: ${peer}`)
  },

  error(peer, error) {
    console.error(`WebSocket error: ${error}`)
    removeConnection(peer)
  }
})
```

- [ ] **Step 4: 修改 server/utils/simulator.ts — 写入 TranscriptionState**

在文件顶部添加导入：

```typescript
import { transcriptionState } from './transcription-state'
```

修改 `startCharacterSimulation` 函数中设置 `simulationState.currentSubtitle` 的地方（约第 76-82 行），在其后添加：

```typescript
    transcriptionState.isActive = true
    transcriptionState.source = 'simulator'
    transcriptionState.currentSubtitle = simulationState.currentSubtitle
```

修改 `confirmSubtitle` 函数中清空 `simulationState.currentSubtitle` 的地方（约第 119 行），在其后添加：

```typescript
    transcriptionState.currentSubtitle = null
```

修改 `confirmSubtitle` 函数中 `simulationState.confirmedSubtitles.push(confirmedSubtitle)` 的地方（约第 127 行），在其后添加：

```typescript
    transcriptionState.confirmedSubtitles.push(confirmedSubtitle)
```

修改 `stopSimulation` 函数，在末尾（约第 225 行之后）添加：

```typescript
    transcriptionState.isActive = false
    transcriptionState.source = null
    transcriptionState.currentSubtitle = null
```

修改 `clearSubtitles` 函数，在 `broadcast` 之前添加：

```typescript
    transcriptionState.confirmedSubtitles = []
    transcriptionState.currentSubtitle = null
```

- [ ] **Step 5: 修改 server/routes/api/status.ts — 返回统一状态**

将文件内容替换为：

```typescript
import { transcriptionState } from '../../utils/transcription-state'
import { getConnectionCount } from '../../utils/websocket'

export default defineEventHandler(() => {
  return {
    isActive: transcriptionState.isActive,
    source: transcriptionState.source,
    connectionCount: getConnectionCount(),
    subtitleCount: transcriptionState.confirmedSubtitles.length
  }
})
```

- [ ] **Step 6: 验证 — 启动 dev server 检查无报错**

```bash
pnpm dev
```

预期: 服务正常启动，`GET /api/status` 返回 `{ isActive: false, source: null, ... }`

- [ ] **Step 7: 提交**

```bash
git add types/transcription.ts server/utils/transcription-state.ts server/routes/api/ws.ts server/utils/simulator.ts server/routes/api/status.ts
git commit -m "refactor: 引入统一转录状态 TranscriptionState"
```

---

## Task 8: Nuxt ASR Bridge

**Files:**
- Create: `server/utils/asr-bridge.ts`

- [ ] **Step 1: 创建 server/utils/asr-bridge.ts**

```typescript
import type { WSMessage, WSCurrentData, WSConfirmedData } from '../../types/websocket'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
import { stopSimulation } from './simulator'

type BridgeStatus = 'disconnected' | 'connecting' | 'connected'

let ws: ReturnType<typeof import('ws').WebSocket> | null = null
let status: BridgeStatus = 'disconnected'
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let config: { url: string; provider: string; model: string } | null = null

let partialVersion = 0
let resultQueue: Array<{ type: string; text: string; language: string }> = []

function connect() {
  if (!config || status === 'connected') return

  status = 'connecting'

  try {
    const WebSocket = require('ws')
    ws = new WebSocket(config.url)

    ws.on('open', () => {
      status = 'connected'
      console.log(`[ASR Bridge] 已连接: ${config.url}`)

      // 发送 config
      ws.send(JSON.stringify({
        type: 'config',
        provider: config.provider,
        model: config.model
      }))

      // 发送缓冲的结果
      while (resultQueue.length > 0) {
        const result = resultQueue.shift()!
        processResult(result)
      }
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'partial' || msg.type === 'final') {
          processResult(msg)
        } else if (msg.type === 'error') {
          console.error(`[ASR Bridge] Python 错误: ${msg.message}`)
        } else if (msg.type === 'loading') {
          console.log('[ASR Bridge] 模型加载中...')
        } else if (msg.type === 'ready') {
          console.log('[ASR Bridge] 模型就绪')
        } else if (msg.type === 'unloaded') {
          console.log('[ASR Bridge] 模型已卸载')
        }
      } catch (e) {
        console.error('[ASR Bridge] 消息解析失败:', e)
      }
    })

    ws.on('close', () => {
      status = 'disconnected'
      console.log('[ASR Bridge] 连接断开')
      scheduleReconnect()
    })

    ws.on('error', (err: Error) => {
      status = 'disconnected'
      console.error('[ASR Bridge] 连接错误:', err.message)
    })
  } catch (e) {
    status = 'disconnected'
    console.error('[ASR Bridge] 创建连接失败:', e)
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 3000)
}

function processResult(result: { type: string; text: string; language: string }) {
  if (result.type === 'partial') {
    partialVersion++
    const data: WSCurrentData = {
      text: result.text,
      enText: '',
      version: partialVersion,
      enVersion: 0
    }
    broadcast({ type: 'current', data })

    transcriptionState.currentSubtitle = {
      text: result.text,
      enText: '',
      version: partialVersion,
      enVersion: 0,
      startTime: Date.now()
    }
  } else if (result.type === 'final') {
    partialVersion = 0
    const id = `asr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    const data: WSConfirmedData = {
      id,
      text: result.text,
      optimizedText: '',
      enText: ''
    }
    broadcast({ type: 'confirmed', data })

    // 清除 current
    broadcast({ type: 'current', data: { text: '', enText: '', version: 0, enVersion: 0 } })
    transcriptionState.currentSubtitle = null
    transcriptionState.confirmedSubtitles.push({
      id,
      text: result.text,
      timestamp: Date.now()
    })
  }
}

export function startASR(
  bridgeConfig: { url: string; provider: string; model: string },
  source: 'mic' | 'stream',
  streamUrl?: string
): boolean {
  if (status === 'connected') {
    stopASR()
  }

  config = bridgeConfig

  // 互斥：停止模拟器
  stopSimulation()

  transcriptionState.isActive = true
  transcriptionState.source = 'asr'

  connect()
  return true
}

export function stopASR(): void {
  transcriptionState.isActive = false
  transcriptionState.source = null
  transcriptionState.currentSubtitle = null

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (ws) {
    ws.close()
    ws = null
  }

  status = 'disconnected'
  config = null
  partialVersion = 0
}

export function getASRStatus() {
  return {
    isActive: transcriptionState.source === 'asr',
    bridgeStatus: status,
    provider: config?.provider ?? null,
    modelLoaded: status === 'connected'
  }
}

export function sendAudioChunk(base64Pcm: string): boolean {
  if (!ws || status !== 'connected') return false
  try {
    ws.send(JSON.stringify({ type: 'audio', data: base64Pcm }))
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add server/utils/asr-bridge.ts
git commit -m "feat: 实现 ASR Bridge（Nuxt ↔ Python WS 桥接）"
```

---

## Task 9: Nuxt ASR REST API

**Files:**
- Create: `server/routes/api/asr/start.ts`
- Create: `server/routes/api/asr/stop.ts`
- Create: `server/routes/api/asr/status.ts`

- [ ] **Step 1: 创建 server/routes/api/asr/start.ts**

```typescript
import { startASR, getASRStatus } from '../../../utils/asr-bridge'

const VALID_PROVIDERS = ['whisper', 'funasr']
const VALID_SOURCES = ['mic', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { provider, model, source, streamUrl } = body

  if (!VALID_PROVIDERS.includes(provider)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`
    })
  }

  if (!VALID_SOURCES.includes(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    })
  }

  if (source === 'stream' && !streamUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'streamUrl is required when source is "stream"'
    })
  }

  const asrStatus = getASRStatus()
  if (asrStatus.isActive) {
    throw createError({
      statusCode: 409,
      statusMessage: 'ASR is already running'
    })
  }

  const url = process.env.ASR_WS_URL || 'ws://localhost:9900'
  const success = startASR(
    { url, provider, model: model || '' },
    source,
    streamUrl
  )

  return {
    success,
    message: success ? 'ASR started' : 'Failed to start ASR',
    provider,
    source
  }
})
```

- [ ] **Step 2: 创建 server/routes/api/asr/stop.ts**

```typescript
import { stopASR } from '../../../utils/asr-bridge'

export default defineEventHandler(() => {
  stopASR()
  return { success: true, message: 'ASR stopped' }
})
```

- [ ] **Step 3: 创建 server/routes/api/asr/status.ts**

```typescript
import { getASRStatus } from '../../../utils/asr-bridge'

export default defineEventHandler(() => {
  return getASRStatus()
})
```

- [ ] **Step 4: 提交**

```bash
git add server/routes/api/asr/
git commit -m "feat: 添加 ASR REST API（start/stop/status）"
```

---

## Task 10: Nuxt WebSocket 双向通信

**Files:**
- Modify: `server/routes/api/ws.ts` — 处理客户端上行消息
- Modify: `composables/useWebSocket.ts` — 添加音频发送能力

- [ ] **Step 1: 修改 server/routes/api/ws.ts — 处理客户端 audio 消息**

在 `open` handler 之前添加 `message` handler。完整的 ws.ts 替换为：

```typescript
import type { WSMessage } from '../../../types/websocket'
import { addConnection, removeConnection, sendTo, broadcast } from '../../utils/websocket'
import { transcriptionState } from '../../utils/transcription-state'
import { sendAudioChunk } from '../../utils/asr-bridge'

export default defineWebSocketHandler({
  open(peer) {
    addConnection(peer)
    console.log(`WebSocket connected: ${peer}`)

    const initMessage: WSMessage = {
      type: 'init',
      data: {
        current: transcriptionState.currentSubtitle?.text ?? null,
        confirmed: transcriptionState.confirmedSubtitles
      }
    }
    sendTo(peer, initMessage)
  },

  message(peer, message) {
    try {
      const data = JSON.parse(message as string)
      if (data.type === 'audio' && data.data) {
        // 透传音频 chunk 给 Python ASR
        sendAudioChunk(data.data)
      }
    } catch {
      // 忽略非 JSON 消息
    }
  },

  close(peer) {
    removeConnection(peer)
    console.log(`WebSocket disconnected: ${peer}`)
  },

  error(peer, error) {
    console.error(`WebSocket error: ${error}`)
    removeConnection(peer)
  }
})
```

- [ ] **Step 2: 修改 composables/useWebSocket.ts — 暴露 send 方法（已存在，无需改动）**

`useWebSocket.ts` 已经有 `send(data: any)` 方法（第 94-100 行），返回 boolean 表示是否发送成功。无需修改。

- [ ] **Step 3: 提交**

```bash
git add server/routes/api/ws.ts
git commit -m "feat: WebSocket 支持双向通信（接收客户端音频）"
```

---

## Task 11: 浏览器音频采集

**Files:**
- Create: `composables/useAudioCapture.ts`
- Create: `public/audio-worklet-processor.js`

- [ ] **Step 1: 创建 public/audio-worklet-processor.js — AudioWorklet 处理器**

```javascript
// AudioWorklet processor: 降采样 + PCM 编码
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array()
    this._targetSampleRate = 16000
    this._outputChunkSize = 1600 // 100ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const channel = input[0]
    this._buffer = Float32Array.from([...this._buffer, ...channel])

    // 需要多少源采样才能产出 outputChunkSize 个目标采样
    const ratio = sampleRate / this._targetSampleRate
    const srcNeeded = Math.ceil(ratio * this._outputChunkSize)

    if (this._buffer.length < srcNeeded) return true

    // 线性降采样：精确产出 outputChunkSize 个目标采样
    const pcm16 = new Int16Array(this._outputChunkSize)
    for (let i = 0; i < this._outputChunkSize; i++) {
      const srcIndex = Math.floor(i * ratio)
      const sample = this._buffer[srcIndex] || 0
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
    }

    // 精确消耗对应数量的源采样，保留余数
    this._buffer = this._buffer.slice(srcNeeded)

    this.port.postMessage({ pcm: pcm16.buffer }, [pcm16.buffer])
    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
```

- [ ] **Step 2: 创建 composables/useAudioCapture.ts**

```typescript
export interface AudioCaptureOptions {
  onAudioChunk: (base64Pcm: string) => void
  onError?: (error: string) => void
}

export function useAudioCapture(options: AudioCaptureOptions) {
  const isCapturing = ref(false)
  let audioContext: AudioContext | null = null
  let workletNode: AudioWorkletNode | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let stream: MediaStream | null = null

  async function start() {
    if (isCapturing.value) return

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      audioContext = new AudioContext({ sampleRate: 48000 })
      await audioContext.audioWorklet.addModule('/audio-worklet-processor.js')

      sourceNode = audioContext.createMediaStreamSource(stream)
      workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')

      workletNode.port.onmessage = (event) => {
        const bytes = new Uint8Array(event.data.pcm)
        const base64 = btoa(String.fromCharCode(...bytes))
        options.onAudioChunk(base64)
      }

      // 只连接 source -> worklet，不连接到 destination（避免回声）
      sourceNode.connect(workletNode)
      isCapturing.value = true
    } catch (e: any) {
      options.onError?.(e.message || '麦克风访问失败')
      cleanup()
    }
  }

  function stop() {
    cleanup()
    isCapturing.value = false
  }

  function cleanup() {
    if (workletNode) {
      workletNode.disconnect()
      workletNode = null
    }
    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      stream = null
    }
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
  }

  onUnmounted(() => {
    cleanup()
  })

  return {
    isCapturing: readonly(isCapturing),
    start,
    stop
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add composables/useAudioCapture.ts public/audio-worklet-processor.js
git commit -m "feat: 实现浏览器音频采集（AudioWorklet + 降采样）"
```

---

## Task 12: 直播流拉取

**Files:**
- Create: `server/utils/stream-manager.ts`
- Create: `server/routes/api/stream/start.ts`
- Create: `server/routes/api/stream/stop.ts`

- [ ] **Step 1: 创建 server/utils/stream-manager.ts — 共享 ffmpeg 进程引用**

```typescript
import { type ChildProcess, spawn } from 'child_process'
import { sendAudioChunk } from './asr-bridge'

let ffmpegProcess: ChildProcess | null = null

export function startStream(url: string): boolean {
  if (ffmpegProcess) return false

  ffmpegProcess = spawn('ffmpeg', [
    '-i', url,
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    '-f', 's16le',
    'pipe:1'
  ])

  const CHUNK_SIZE = 3200 // 100ms at 16kHz mono 16bit
  let streamBuffer = Buffer.alloc(0)

  ffmpegProcess.stdout?.on('data', (chunk: Buffer) => {
    streamBuffer = Buffer.concat([streamBuffer, chunk])
    while (streamBuffer.length >= CHUNK_SIZE) {
      const send = streamBuffer.subarray(0, CHUNK_SIZE)
      streamBuffer = streamBuffer.subarray(CHUNK_SIZE)
      sendAudioChunk(send.toString('base64'))
    }
  })

  ffmpegProcess.stderr?.on('data', () => {
    // ffmpeg 进度信息，静默
  })
    console.log(`[Stream] ffmpeg 退出, code=${code}`)
    ffmpegProcess = null
  })

  ffmpegProcess.on('error', (err) => {
    console.error(`[Stream] ffmpeg 错误: ${err.message}`)
    ffmpegProcess = null
  })

  return true
}

export function stopStream(): boolean {
  if (!ffmpegProcess) return false
  ffmpegProcess.kill('SIGTERM')
  ffmpegProcess = null
  return true
}

export function isStreamRunning(): boolean {
  return ffmpegProcess !== null
}
```

- [ ] **Step 2: 创建 server/routes/api/stream/start.ts**

```typescript
import { startStream, isStreamRunning } from '../../../utils/stream-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { url } = body

  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing url parameter'
    })
  }

  if (isStreamRunning()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Stream is already running'
    })
  }

  const success = startStream(url)

  return {
    success: true,
    message: 'Stream started',
    url
  }
})
```

- [ ] **Step 3: 创建 server/routes/api/stream/stop.ts**

```typescript
import { stopStream } from '../../../utils/stream-manager'

export default defineEventHandler(() => {
  stopStream()
  return { success: true, message: 'Stream stopped' }
})
```

- [ ] **Step 4: 提交**

```bash
git add server/utils/stream-manager.ts server/routes/api/stream/
git commit -m "feat: 实现直播流拉取（ffmpeg → ASR）"
```

---

## Task 13: 管理后台 ASR 控制面板

**Files:**
- Create: `components/admin/ASRControlPanel.vue`
- Create: `components/admin/ModelStatusPanel.vue`
- Modify: `pages/admin.vue` — 集成 ASR 面板

- [ ] **Step 1: 创建 components/admin/ASRControlPanel.vue**

```vue
<script setup lang="ts">
const props = defineProps<{
  isRunning: boolean
  isLoading: boolean
}>()

const emit = defineEmits<{
  start: [config: { provider: string; model: string; source: string; streamUrl?: string }]
  stop: []
}>()

const provider = ref('whisper')
const source = ref('mic')
const streamUrl = ref('')
const availableProviders = ['whisper', 'funasr']

const handleStart = () => {
  emit('start', {
    provider: provider.value,
    model: '',
    source: source.value,
    streamUrl: source.value === 'stream' ? streamUrl.value : undefined
  })
}
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
      </div>
      <span class="panel-title">ASR CONTROL</span>
      <span
        v-if="isRunning"
        class="status-badge active"
      >LIVE</span>
    </div>

    <div class="panel-content">
      <div class="form-row">
        <label class="form-label">PROVIDER</label>
        <div class="provider-grid">
          <button
            v-for="p in availableProviders"
            :key="p"
            class="provider-btn"
            :class="{ active: provider === p }"
            :disabled="isRunning"
            @click="provider = p"
          >
            {{ p }}
          </button>
        </div>
      </div>

      <div class="form-row">
        <label class="form-label">SOURCE</label>
        <div class="source-grid">
          <button
            class="source-btn"
            :class="{ active: source === 'mic' }"
            :disabled="isRunning"
            @click="source = 'mic'"
          >Microphone</button>
          <button
            class="source-btn"
            :class="{ active: source === 'stream' }"
            :disabled="isRunning"
            @click="source = 'stream'"
          >Stream URL</button>
        </div>
      </div>

      <div v-if="source === 'stream'" class="form-row">
        <label class="form-label">STREAM URL</label>
        <input
          v-model="streamUrl"
          type="text"
          class="form-input"
          placeholder="rtmp://... or https://..."
          :disabled="isRunning"
        />
      </div>

      <div class="action-row">
        <button
          v-if="!isRunning"
          class="action-btn start"
          :disabled="isLoading || (source === 'stream' && !streamUrl)"
          @click="handleStart"
        >
          START ASR
        </button>
        <button
          v-else
          class="action-btn stop"
          :disabled="isLoading"
          @click="emit('stop')"
        >
          STOP ASR
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
}

.panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.5), transparent);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.panel-icon {
  width: 36px;
  height: 36px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
}

.panel-icon svg {
  width: 20px;
  height: 20px;
}

.panel-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.status-badge {
  margin-left: auto;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.status-badge.active {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid rgba(16, 185, 129, 0.5);
  color: #10b981;
  animation: pulse 1.5s ease-in-out infinite;
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.7);
}

.provider-grid, .source-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.provider-btn, .source-btn {
  padding: 0.6rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: 8px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.provider-btn:hover:not(:disabled), .source-btn:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
}

.provider-btn.active, .source-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

.provider-btn:disabled, .source-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form-input {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  transition: all 0.3s ease;
  width: 100%;
}

.form-input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1);
}

.form-input::placeholder {
  color: rgba(148, 163, 184, 0.4);
}

.form-input:disabled {
  opacity: 0.5;
}

.action-row {
  margin-top: 0.5rem;
}

.action-btn {
  width: 100%;
  padding: 0.75rem;
  border-radius: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid;
}

.action-btn.start {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1));
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
}

.action-btn.start:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.2));
  border-color: rgba(16, 185, 129, 0.6);
}

.action-btn.stop {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1));
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

.action-btn.stop:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.2));
  border-color: rgba(239, 68, 68, 0.6);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
</style>
```

- [ ] **Step 2: 创建 components/admin/ModelStatusPanel.vue**

```vue
<script setup lang="ts">
const modelStatus = ref<{
  bridgeStatus: string
  provider: string | null
  modelLoaded: boolean
} | null>(null)

async function fetchStatus() {
  try {
    const res = await $fetch('/api/asr/status')
    modelStatus.value = res as typeof modelStatus.value
  } catch {
    // ignore
  }
}

onMounted(() => {
  fetchStatus()
  const interval = setInterval(fetchStatus, 3000)
  onUnmounted(() => clearInterval(interval))
})
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <rect x="9" y="9" width="6" height="6"/>
        </svg>
      </div>
      <span class="panel-title">MODEL STATUS</span>
    </div>

    <div v-if="modelStatus" class="status-grid">
      <div class="info-row">
        <span class="info-label">BRIDGE</span>
        <span class="info-value" :class="{ highlight: modelStatus.bridgeStatus === 'connected' }">
          {{ modelStatus.bridgeStatus }}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">PROVIDER</span>
        <span class="info-value">{{ modelStatus.provider || '—' }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">MODEL</span>
        <span class="info-value" :class="{ highlight: modelStatus.modelLoaded }">
          {{ modelStatus.modelLoaded ? 'LOADED' : 'IDLE' }}
        </span>
      </div>
    </div>
    <div v-else class="loading-hint">Loading...</div>
  </div>
</template>

<style scoped>
.panel {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
}

.panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.5), transparent);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.panel-icon {
  width: 36px; height: 36px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
}

.panel-icon svg { width: 20px; height: 20px; }

.panel-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.8rem; font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.status-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border-left: 3px solid rgba(56, 189, 248, 0.3);
}

.info-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.6);
}

.info-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.75rem; font-weight: 500;
  color: #e2e8f0;
}

.info-value.highlight { color: #22d3ee; }

.loading-hint {
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.5);
  text-align: center;
  padding: 1rem;
}
</style>
```

- [ ] **Step 3: 修改 pages/admin.vue — 集成 ASR 控制面板**

在 `<script setup>` 中添加 ASR 相关状态和方法。在现有的 `// 获取状态` 注释之前添加：

```typescript
// ASR 相关状态
const asrIsRunning = ref(false)
const asrIsLoading = ref(false)

const handleASRStart = async (config: { provider: string; model: string; source: string; streamUrl?: string }) => {
  asrIsLoading.value = true
  try {
    await $fetch('/api/asr/start', {
      method: 'POST',
      body: config
    })
    asrIsRunning.value = true
    await fetchStatus()
  } catch (error) {
    console.error('Failed to start ASR:', error)
  } finally {
    asrIsLoading.value = false
  }
}

const handleASRStop = async () => {
  asrIsLoading.value = true
  try {
    await $fetch('/api/asr/stop', { method: 'POST' })
    asrIsRunning.value = false
    await fetchStatus()
  } catch (error) {
    console.error('Failed to stop ASR:', error)
  } finally {
    asrIsLoading.value = false
  }
}
```

在 `<template>` 的 `control-grid` 中，在 `<AdminControlPanel>` 之后添加：

```html
        <!-- ASR 控制面板 -->
        <ASRControlPanel
          :is-running="asrIsRunning"
          :is-loading="asrIsLoading"
          @start="handleASRStart"
          @stop="handleASRStop"
        />

        <!-- 模型状态面板 -->
        <ModelStatusPanel />
```

修改 `status-bar` 中的 `isRunning`，使其也反映 ASR 状态。在 `fetchStatus` 函数中添加：

```typescript
    asrIsRunning.value = (response as any).source === 'asr'
```

修改 status-bar 的 BROADCASTING 判断：

```html
          <span class="status-text">{{ (isRunning || asrIsRunning) ? 'BROADCASTING' : 'STANDBY' }}</span>
```

```html
          <span class="status-dot" :class="{ active: isRunning || asrIsRunning }"></span>
```

- [ ] **Step 3: 提交**

```bash
git add components/admin/ASRControlPanel.vue components/admin/ModelStatusPanel.vue pages/admin.vue
git commit -m "feat: 添加管理后台 ASR 控制面板和模型状态面板"
```

---

## Task 14: 端到端验证

**Files:** 无新建/修改

- [ ] **Step 1: 启动 Python ASR 服务**

```bash
conda activate trans
cd /home/zhenyi/ownprojects/servicelivetrans
python asr/server.py
```

预期输出: `ASR 服务启动: ws://0.0.0.0:9900`，`可用 Provider: ['whisper']`

- [ ] **Step 2: 另一个终端启动 Nuxt 开发服务器**

```bash
pnpm dev
```

- [ ] **Step 3: 验证 API 端点**

```bash
curl http://localhost:3000/api/status
# 预期: {"isActive":false,"source":null,"connectionCount":0,"subtitleCount":0}

curl http://localhost:3000/api/asr/status
# 预期: {"isActive":false,"bridgeStatus":"disconnected","provider":null,"modelLoaded":false}
```

- [ ] **Step 4: 验证管理后台**

打开 `http://localhost:3000/admin`，确认：
- ASR CONTROL 面板可见
- Provider 选择和 Source 选择按钮可点击
- START ASR 按钮可点击

- [ ] **Step 5: 验证模拟器仍正常工作**

打开 `http://localhost:3000/admin`，点击模拟器的 START，确认前端展示页正常显示模拟字幕。然后 STOP。

- [ ] **Step 6: 验证互斥**

启动模拟器后，点击 START ASR，确认模拟器自动停止。然后 STOP ASR，确认状态正确。

- [ ] **Step 7: 提交（如有修复）**

```bash
git add -A
git commit -m "fix: 修复端到端验证中发现的问题"
```
