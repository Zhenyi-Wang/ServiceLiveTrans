"""WebSocket 消息协议定义"""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
import json
import base64
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


def decode_message(raw: str) -> dict:
    """解析客户端发来的 JSON 消息"""
    return json.loads(raw)


def encode_message(msg) -> str:
    """将 dataclass 消息编码为 JSON"""
    return json.dumps(asdict(msg))
