# ASR 配置系统统一 + VAD 分段调优 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 ASR 配置系统（消除 config.yaml 与 SQLite 重叠），修复 apply_config 热更新 bug，调优 VAD 参数减少误切断句。

**Architecture:** config.yaml 只保留静态参数（模型路径、GPU 等），动态参数（VAD、温度等）由 SQLite 独管。GGUFProvider 属性名与 config key 统一为 snake_case，消除 apply_config 的属性名映射断裂。

**Tech Stack:** Python 3 (ASR 后端), Vue 3 + Nuxt (前端 admin 面板), SQLite (动态配置持久化)

---

### Task 1: GGUFProvider 属性名统一 + fallback 修正

**Files:**

- Modify: `asr/providers/gguf/provider.py:45-50` (init 赋值)
- Modify: `asr/providers/gguf/provider.py:166-168` (\_process_loop 引用)

- [ ] **Step 1: 修改 `__init__` 中的 3 处属性名 + overlap_sec fallback**

`asr/providers/gguf/provider.py` 第 44-50 行，将：

```python
        # 缓冲策略
        self.max_buffer_sec = config.get("vad_max_buffer_sec", 10.0)
        self.min_buffer_sec = config.get("vad_min_buffer_sec", 0.5)
        self.vad_threshold = config.get("vad_threshold", 0.5)
        self.silence_check_ms = config.get("vad_silence_ms", 300)
        self.sentence_min_len = config.get("sentence_min_len", 5)
        self.overlap_sec = config.get("overlap_sec", 0.5)
```

改为：

```python
        # 缓冲策略
        self.vad_max_buffer_sec = config.get("vad_max_buffer_sec", 10.0)
        self.vad_min_buffer_sec = config.get("vad_min_buffer_sec", 1.5)
        self.vad_threshold = config.get("vad_threshold", 0.5)
        self.vad_silence_ms = config.get("vad_silence_ms", 700)
        self.sentence_min_len = config.get("sentence_min_len", 5)
        self.overlap_sec = config.get("overlap_sec", 0.1)
```

变更点：

- `self.max_buffer_sec` → `self.vad_max_buffer_sec`
- `self.min_buffer_sec` → `self.vad_min_buffer_sec`
- `self.silence_check_ms` → `self.vad_silence_ms`
- `vad_min_buffer_sec` fallback `0.5` → `1.5`
- `vad_silence_ms` fallback `300` → `700`
- `overlap_sec` fallback `0.5` → `0.1`

- [ ] **Step 2: 修改 `_process_loop` 中的 3 处属性引用**

`asr/providers/gguf/provider.py` 第 166-168 行，将：

```python
            max_buffer_samples = int(self.max_buffer_sec * SAMPLE_RATE)
            min_buffer_samples = int(self.min_buffer_sec * SAMPLE_RATE)
            silence_frames = int(self.silence_check_ms / 32)
```

改为：

```python
            max_buffer_samples = int(self.vad_max_buffer_sec * SAMPLE_RATE)
            min_buffer_samples = int(self.vad_min_buffer_sec * SAMPLE_RATE)
            silence_frames = int(self.vad_silence_ms / 32)
```

- [ ] **Step 3: 添加启动时参数日志**

在 `asr/providers/gguf/provider.py` 的 `start()` 方法中（第 67 行 `logger.info` 之前），添加参数日志：

```python
    async def start(self) -> None:
        self._loop = asyncio.get_event_loop()
        await self._load_engine()
        self._load_vad()
        self._is_running = True
        self._process_task = asyncio.create_task(self._process_loop())
        logger.info(
            f"GGUF Provider 已启动 (model_dir={self.model_dir}, "
            f"vad_silence_ms={self.vad_silence_ms}, vad_min_buffer_sec={self.vad_min_buffer_sec}, "
            f"overlap_sec={self.overlap_sec}, vad_threshold={self.vad_threshold})"
        )
```

- [ ] **Step 4: 运行 Python 类型检查和 lint**

Run: `cd /home/zhenyi/ownprojects/servicelivetrans && ruff check asr/providers/gguf/provider.py && ruff format --check asr/providers/gguf/provider.py && pyright asr/providers/gguf/provider.py`

Expected: 全部通过，无错误

---

### Task 2: config.yaml 删除动态参数

**Files:**

- Modify: `asr/config.yaml`

- [ ] **Step 1: 删除 gguf 节下的 10 个动态 key**

`asr/config.yaml` 将整个文件改为：

```yaml
server:
  host: '0.0.0.0'
  port: 9900
  idle_timeout: 300
  check_interval: 60

gguf:
  # 模型目录，支持 $GGUF_MODEL_DIR 环境变量覆盖
  model_dir: '~/models/qwen3-asr-gguf'
  llm_fn: 'qwen3_asr_llm.q4_k.gguf'
  encoder_frontend_fn: 'qwen3_asr_encoder_frontend.int4.onnx'
  encoder_backend_fn: 'qwen3_asr_encoder_backend.int4.onnx'
  onnx_provider: 'CUDA'
  llm_use_gpu: true
  n_ctx: 2048
  verbose: false
```

删除的 10 个 key：`language`, `rollback_num`, `memory_chunks`, `overlap_sec`, `temperature`, `vad_threshold`, `vad_max_buffer_sec`, `vad_min_buffer_sec`, `vad_silence_ms`, `sentence_min_len`。
（`send_partial` 本来就不在此文件中）

---

### Task 3: server.py — DEFAULT_DYNAMIC_CONFIG + 更新默认值

**Files:**

- Modify: `asr/server.py:224-242` (main 函数中的 default_config)

- [ ] **Step 1: 将 `default_config` 替换为 `DEFAULT_DYNAMIC_CONFIG` 并更新默认值**

`asr/server.py` 第 224-242 行，将 `main()` 函数中的：

```python
    # 初始化 SQLite 默认配置
    default_config = {
        "overlap_sec": 0.1,
        "memory_chunks": 2,
        "vad_threshold": 0.5,
        "vad_max_buffer_sec": 10.0,
        "vad_min_buffer_sec": 0.5,
        "vad_silence_ms": 300,
        "temperature": 0.4,
        "language": "Chinese",
        "send_partial": False,
        "sentence_min_len": 5,
        "rollback_num": 5,
    }
    init_defaults(default_config)
```

改为：

```python
    DEFAULT_DYNAMIC_CONFIG = {
        "overlap_sec": 0.1,
        "memory_chunks": 2,
        "vad_threshold": 0.5,
        "vad_max_buffer_sec": 10.0,
        "vad_min_buffer_sec": 1.5,
        "vad_silence_ms": 700,
        "temperature": 0.4,
        "language": "Chinese",
        "send_partial": False,
        "sentence_min_len": 5,
        "rollback_num": 5,
    }

    # 初始化 SQLite 默认配置（INSERT OR IGNORE，不覆盖已有值）
    init_defaults(DEFAULT_DYNAMIC_CONFIG)
```

变更点：`vad_min_buffer_sec` 0.5→1.5，`vad_silence_ms` 300→700。

- [ ] **Step 2: 运行 Python 类型检查和 lint**

Run: `cd /home/zhenyi/ownprojects/servicelivetrans && ruff check asr/server.py && ruff format --check asr/server.py && pyright asr/server.py`

Expected: 全部通过

---

### Task 4: model_manager.py — 配置合并

**Files:**

- Modify: `asr/model_manager.py:1-23` (imports + create_provider)

- [ ] **Step 1: 添加 import 并修改 create_provider 合并配置**

`asr/model_manager.py` 第 1-23 行，将：

```python
"""模型生命周期管理：按需加载、空闲卸载、OOM 降级"""

from __future__ import annotations

import asyncio
import contextlib
import gc
import logging
import time

from asr.providers.base import ASRProvider

logger = logging.getLogger(__name__)


def create_provider(provider: str, model_name: str, config_loader) -> ASRProvider:
    if provider == "gguf":
        from asr.providers.gguf import GGUFProvider

        return GGUFProvider(config_loader.gguf_config())
    else:
        raise ValueError(f"Unknown provider: {provider}")
```

改为：

```python
"""模型生命周期管理：按需加载、空闲卸载、OOM 降级"""

from __future__ import annotations

import asyncio
import contextlib
import gc
import logging
import time

from asr import config_db
from asr.providers.base import ASRProvider

logger = logging.getLogger(__name__)


def create_provider(provider: str, model_name: str, config_loader) -> ASRProvider:
    if provider == "gguf":
        from asr.providers.gguf import GGUFProvider

        static_cfg = config_loader.gguf_config()
        dynamic_cfg = config_db.get_all()
        merged = {**static_cfg, **dynamic_cfg}
        return GGUFProvider(merged)
    else:
        raise ValueError(f"Unknown provider: {provider}")
```

关键变更：

- 新增 `from asr import config_db`
- `create_provider` 内先读静态配置（yaml），再读动态配置（SQLite），合并后传给 GGUFProvider
- 这样 ASR 服务重启后 provider 会从 SQLite 恢复上次的动态配置

- [ ] **Step 2: 运行 Python 类型检查和 lint**

Run: `cd /home/zhenyi/ownprojects/servicelivetrans && ruff check asr/model_manager.py && ruff format --check asr/model_manager.py && pyright asr/model_manager.py`

Expected: 全部通过

---

### Task 5: 前端默认值 + select options 更新

**Files:**

- Modify: `components/admin/TranscriptionControlPanel.vue:74-75` (默认值)
- Modify: `components/admin/TranscriptionControlPanel.vue:813-821` (最小缓冲 select options)
- Modify: `components/admin/TranscriptionControlPanel.vue:823-832` (静音检测 select options)
- Modify: `components/admin/TranscriptionControlPanel.vue:872-881` (最短句长 tooltip)

- [ ] **Step 1: 更新 advancedSettings 默认值**

`components/admin/TranscriptionControlPanel.vue` 第 74-75 行，将：

```typescript
  vadMinBufferSec: 0.5,
  vadSilenceMs: 300,
```

改为：

```typescript
  vadMinBufferSec: 1.5,
  vadSilenceMs: 700,
```

- [ ] **Step 2: 更新"最小缓冲"select options，添加 1.5 选项**

`components/admin/TranscriptionControlPanel.vue` 第 813-821 行的"最小缓冲 (秒)"select，将：

```html
<select v-model.number="advancedSettings.vadMinBufferSec" class="form-input">
  <option :value="0.3">0.3</option>
  <option :value="0.5">0.5 (默认)</option>
  <option :value="0.8">0.8</option>
  <option :value="1.0">1.0</option>
</select>
```

改为：

```html
<select v-model.number="advancedSettings.vadMinBufferSec" class="form-input">
  <option :value="0.3">0.3</option>
  <option :value="0.5">0.5</option>
  <option :value="0.8">0.8</option>
  <option :value="1.0">1.0</option>
  <option :value="1.5">1.5 (默认)</option>
  <option :value="2.0">2.0</option>
</select>
```

- [ ] **Step 3: 更新"静音检测"select options，标记 700 为默认**

`components/admin/TranscriptionControlPanel.vue` 第 823-832 行的"静音检测 (ms)"select，将：

```html
<select v-model.number="advancedSettings.vadSilenceMs" class="form-input">
  <option :value="200">200</option>
  <option :value="300">300 (默认)</option>
  <option :value="500">500</option>
  <option :value="700">700</option>
  <option :value="1000">1000</option>
</select>
```

改为：

```html
<select v-model.number="advancedSettings.vadSilenceMs" class="form-input">
  <option :value="200">200</option>
  <option :value="300">300</option>
  <option :value="500">500</option>
  <option :value="700">700 (默认)</option>
  <option :value="1000">1000</option>
</select>
```

- [ ] **Step 4: 为"最短句长"添加未生效提示**

`components/admin/TranscriptionControlPanel.vue` 第 872 行的"最短句长"label，将：

```html
<label class="form-label">最短句长</label>
```

改为：

```html
<label class="form-label">
  最短句长
  <span style="font-size: 0.6rem; color: rgba(251, 191, 36, 0.7); letter-spacing: 0.05em"
    >（暂未生效）</span
  >
</label>
```

- [ ] **Step 5: 运行前端构建验证**

Run: `cd /home/zhenyi/ownprojects/servicelivetrans && pnpm build`

Expected: 构建成功，无错误

---

### Task 6: 全量验证

- [ ] **Step 1: 运行完整 Python 检查**

Run: `cd /home/zhenyi/ownprojects/servicelivetrans && ruff check asr/ && ruff format --check asr/ && pyright`

Expected: 全部通过

- [ ] **Step 2: 运行完整前端检查**

Run: `cd /home/zhenyi/ownprojects/servicelivetrans && pnpm lint && pnpm format:check && pnpm typecheck`

Expected: 全部通过

- [ ] **Step 3: 删除旧的 SQLite 配置数据库以重新初始化默认值**

Run: `rm -f /home/zhenyi/ownprojects/servicelivetrans/asr/data/config.db`

说明：旧的 SQLite 中保存了 `vad_silence_ms=300` 和 `vad_min_buffer_sec=0.5`。删除后重启 ASR 服务时 `init_defaults(DEFAULT_DYNAMIC_CONFIG)` 会用新默认值填充。如果用户有其他自定义配置不希望丢失，可以跳过此步骤——旧值会被 `INSERT OR IGNORE` 保留，需要用户通过 admin UI 手动更新。

- [ ] **Step 4: 启动 ASR 服务确认参数日志**

Run: `cd /home/zhenyi/ownprojects/servicelivetrans && python -m asr.server`

Expected: 日志中出现 `vad_silence_ms=700, vad_min_buffer_sec=1.5, overlap_sec=0.1`
