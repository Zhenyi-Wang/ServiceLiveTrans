# ASR 配置系统统一 + VAD 分段调优

日期: 2026-05-24

## 背景

ASR 转录输出存在严重的错误断句问题——句号出现在句子中间，短片段被独立发送。
排查发现两个互相叠加的根因：

1. **配置系统混乱**：config.yaml 和 SQLite 有重复字段，GGUFProvider 属性名与 config key 不一致导致 `apply_config` 热更新对 3 个 VAD 参数静默失效，SQLite 写入后无读回机制
2. **VAD 分段过于激进**：尾部静音窗口仅 288ms，最短缓冲 0.5s，换气和微停顿就触发断句；`sentence_min_len` 参数声明但未实现

## 方案概述

- **配置系统重构**：config.yaml 只保留静态参数，动态参数由 SQLite 独管，零重叠
- **属性名统一**：GGUFProvider 实例属性名与 config key 完全一致
- **VAD 参数调优**：调大静音窗口和最短缓冲，减少误切
- **scope 不含 Nuxt 端**：fragment 合并留给后续迭代

## Section 1：配置分层

### 静态配置（config.yaml）

安装时决定，运行时不变。`ASRConfig.gguf_config()` 只返回以下静态参数：

```yaml
gguf:
  model_dir: ~/models/qwen3-asr-gguf
  llm_fn: qwen3_asr_llm.q4_k.gguf
  encoder_frontend_fn: qwen3_asr_encoder_frontend.int4.onnx
  encoder_backend_fn: qwen3_asr_encoder_backend.int4.onnx
  onnx_provider: CUDA
  llm_use_gpu: true
  n_ctx: 2048
  verbose: false
```

以下 11 个 key 从 config.yaml 的 gguf 节删除，移至 SQLite 动态管理：

`language`, `rollback_num`, `memory_chunks`, `overlap_sec`, `temperature`, `vad_threshold`, `vad_max_buffer_sec`, `vad_min_buffer_sec`, `vad_silence_ms`, `sentence_min_len`, `send_partial`

注意：`send_partial` 当前不在 config.yaml 中（已在 SQLite 有默认值），删除操作不涉及此 key。

### 动态配置（SQLite）

admin UI 可调，持久化，重启后恢复。默认值在 server.py 唯一定义：

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
```

### 合并流程

合并发生在 `model_manager.create_provider()` 内部，它是创建 provider 的唯一入口：

```python
# model_manager.py
def create_provider(provider, model_name, config_loader):
    static_cfg = config_loader.gguf_config()      # yaml → 只有静态参数
    dynamic_cfg = config_db.get_all()              # SQLite → 动态参数
    merged = {**static_cfg, **dynamic_cfg}         # 合并
    return GGUFProvider(merged)                    # provider 不感知来源
```

- 首次启动：`init_defaults(DEFAULT_DYNAMIC_CONFIG)` 填充 SQLite
- 用户通过 admin 修改：写入 SQLite + `apply_config` 热更新
- ASR 服务重启：从 SQLite 恢复上次设置

### 改动文件

- `asr/config.yaml` — 删除 gguf 节下的 11 个动态 key
- `asr/server.py` — 将 `default_config` 替换为 `DEFAULT_DYNAMIC_CONFIG`
- `asr/model_manager.py` — `create_provider` 从 config_loader 读静态配置 + 从 SQLite 读动态配置，合并后传给 GGUFProvider

## Section 2：GGUFProvider 属性名统一

### 属性名变更

| 改前                    | 改后                      | config key           |
| ----------------------- | ------------------------- | -------------------- |
| `self.max_buffer_sec`   | `self.vad_max_buffer_sec` | `vad_max_buffer_sec` |
| `self.min_buffer_sec`   | `self.vad_min_buffer_sec` | `vad_min_buffer_sec` |
| `self.silence_check_ms` | `self.vad_silence_ms`     | `vad_silence_ms`     |

其他属性名（`overlap_sec`, `memory_chunks`, `vad_threshold`, `temperature`, `language`, `send_partial`, `sentence_min_len`, `rollback_num`）已经一致，不需改动。

### fallback 值修正

`overlap_sec` 的 fallback 从 `0.5` 修正为 `0.1`，与 `DEFAULT_DYNAMIC_CONFIG` 一致：

```python
self.overlap_sec = config.get("overlap_sec", 0.1)  # 原为 0.5
```

### 影响范围

- `__init__`：3 处赋值改属性名 + `overlap_sec` fallback 值修正
- `_process_loop`：所有引用 `self.max_buffer_sec`, `self.min_buffer_sec`, `self.silence_check_ms` 的地方同步改名（实际约 4 处：L166, L167, L168 各一处 + 计算常量处）
- `apply_config`：不需要改动，`setattr` 自然生效
- fallback 值与 `DEFAULT_DYNAMIC_CONFIG` 对齐

### 改动文件

- `asr/providers/gguf/provider.py` — 属性重命名 + fallback 值修正

## Section 3：VAD 参数调优

### 参数变更

| 参数                 | 改前 | 改后 | 理由                                          |
| -------------------- | ---- | ---- | --------------------------------------------- |
| `vad_silence_ms`     | 300  | 700  | 尾部窗口从 288ms→672ms，换气/微停顿不触发断句 |
| `vad_min_buffer_sec` | 0.5  | 1.5  | 不足 1.5s 不做静音检测，避免 2-3 字碎片       |
| `vad_threshold`      | 0.5  | 0.5  | 不变                                          |
| `vad_max_buffer_sec` | 10.0 | 10.0 | 不变                                          |

### sentence_min_len

参数保留在动态配置中，默认值 5，**本轮不实现逻辑**。文本级拼接有语义风险（重复文本、边界错误），应该放到后续 Nuxt 端 fragment 合并中一起做。

**前端展示策略**：`sentence_min_len` 在 admin 面板中保留展示（已有 UI），但增加 tooltip 或提示说明"此参数暂未生效，将在后续版本中启用"，避免用户调参后无效果产生困惑。

### 改动文件

- `asr/server.py` — `DEFAULT_DYNAMIC_CONFIG` 中的默认值变更
- `components/admin/TranscriptionControlPanel.vue` 第 74-75 行 — `vadMinBufferSec` 从 `0.5` 改为 `1.5`，`vadSilenceMs` 从 `300` 改为 `700`

## 不在范围

- Nuxt 端 segment 合并/标点处理
- AI processor 批量上下文
- 前端 ParagraphLogic 改动

## 验证方式

1. 启动 ASR 服务，确认日志中打印 `GGUFProvider` 实际使用的所有参数值（`vad_silence_ms=700`, `vad_min_buffer_sec=1.5`, `overlap_sec=0.1`）
2. 通过 admin 修改 VAD 参数，确认热更新生效（`apply_config` 后 `_process_loop` 使用新值）
3. 重启 ASR 服务，确认参数从 SQLite 恢复而非 yaml 默认值
4. 用直播流或麦克风输入测试，观察断句改善情况
