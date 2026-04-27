"""WebSocket 消息协议定义"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
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


@dataclass
class ASRResult:
    type: Literal["partial", "final"]
    text: str
    language: Literal["zh", "en"]


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
    language: Literal["zh", "en"] = "zh"


@dataclass
class FinalResult:
    type: Literal["final"] = "final"
    text: str = ""
    language: Literal["zh", "en"] = "zh"


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


AnyMessage = (
    ConfigMessage
    | AudioMessage
    | ModelLoadMessage
    | ModelUnloadMessage
    | ModelStatusMessage
    | PartialResult
    | FinalResult
    | ErrorMessage
    | LoadingEvent
    | ReadyEvent
    | UnloadedEvent
    | ModelStatusResponse
)

_CLIENT_MSG_TYPES: dict[str, type] = {
    "config": ConfigMessage,
    "audio": AudioMessage,
    "model/load": ModelLoadMessage,
    "model/unload": ModelUnloadMessage,
    "model/status": ModelStatusMessage,
}


def decode_message(raw: str) -> AnyMessage:
    """解析客户端发来的 JSON 消息为对应 dataclass"""
    data = json.loads(raw)
    cls = _CLIENT_MSG_TYPES.get(data.get("type", ""))
    if cls is None:
        raise ValueError(f"Unknown message type: {data.get('type')}")
    return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


def encode_message(msg: AnyMessage) -> str:
    """将 dataclass 消息编码为 JSON"""
    return json.dumps(asdict(msg))
