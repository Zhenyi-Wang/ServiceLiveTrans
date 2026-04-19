"""配置加载"""
from __future__ import annotations
import os
from pathlib import Path
import yaml


class ASRConfig:
    def __init__(self, config_path: str | None = None):
        if config_path is None:
            config_path = str(Path(__file__).parent / "config.yaml")
        with open(config_path) as f:
            self._raw = yaml.safe_load(f)
        if self._raw is None:
            self._raw = {}

    def _require(self, *keys: str) -> str:
        node = self._raw
        for key in keys:
            if not isinstance(node, dict) or key not in node:
                raise KeyError(f"Missing config key: {'.'.join(keys)}")
            node = node[key]
        return node

    @property
    def server_host(self) -> str:
        return self._require("server", "host")

    @property
    def server_port(self) -> int:
        return self._require("server", "port")

    @property
    def idle_timeout(self) -> int:
        return self._require("server", "idle_timeout")

    @property
    def check_interval(self) -> int:
        return self._require("server", "check_interval")

    def whisper_config(self) -> dict:
        cfg = dict(self._require("whisper"))
        env_model = os.environ.get("WHISPER_MODEL_PATH")
        if env_model:
            cfg["model"] = env_model
        return cfg

    def funasr_config(self) -> dict:
        return dict(self._require("funasr"))
