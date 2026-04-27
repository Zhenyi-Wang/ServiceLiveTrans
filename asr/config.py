"""配置加载"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


class ASRConfig:
    def __init__(self, config_path: str | None = None):
        if config_path is None:
            config_path = str(Path(__file__).parent / "config.yaml")
        with open(config_path) as f:
            self._raw: dict[str, Any] = yaml.safe_load(f) or {}

    def _require(self, *keys: str) -> Any:
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
        return int(self._require("server", "port"))

    @property
    def idle_timeout(self) -> int:
        return int(self._require("server", "idle_timeout"))

    @property
    def check_interval(self) -> int:
        return int(self._require("server", "check_interval"))

    def gguf_config(self) -> dict[str, Any]:
        cfg: dict[str, Any] = dict(self._require("gguf"))
        env_model_dir = os.environ.get("GGUF_MODEL_DIR")
        if env_model_dir:
            cfg["model_dir"] = env_model_dir
        cfg["model_dir"] = os.path.expanduser(cfg["model_dir"])
        return cfg
