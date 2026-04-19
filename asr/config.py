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
