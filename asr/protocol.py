"""WebSocket 消息协议定义"""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
import json
from dataclasses import asdict
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


def decode_message(raw: str) -> dict:
    """解析客户端发来的 JSON 消息"""
    return json.loads(raw)


def encode_message(msg) -> str:
    """将 dataclass 消息编码为 JSON"""
    return json.dumps(asdict(msg))
