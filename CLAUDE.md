# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ServiceLiveTrans 是一个实时语音转录服务，支持直播源（FLV）和麦克风输入。功能包括网页后台控制、AI 文本润色/翻译、聚会预约和转录稿存储。

本项目目标是替代同级的 `../livetrans` 并提供更多功能。开发时可能需要借鉴 livetrans 的许多逻辑，用户提到参考时需前往 livetrans 项目查找代码。

## 命令

```bash
pnpm dev         # 启动开发服务器
pnpm build       # 构建生产版本
pnpm preview     # 预览生产版本
pnpm generate    # 生成静态站点
pnpm lint        # ESLint 检查
pnpm lint:fix    # ESLint 自动修复
pnpm format:check  # Prettier 格式检查
pnpm format      # Prettier 自动格式化
pnpm typecheck   # vue-tsc 类型检查
```

## 代码规范

### 前端（Vue/TypeScript）

- **格式化**：Prettier — 2 空格缩进、无分号、单引号、trailing comma
- **Lint**：ESLint — 通过 `@nuxt/eslint` 模块集成，flat config 在 `eslint.config.mjs`
- **类型检查**：vue-tsc — `pnpm typecheck`
- **ESLint + Prettier 冲突**：通过 `eslint-config-prettier` 禁用 ESLint 中与 Prettier 冲突的规则

### Python（ASR 后端）

- **格式化**：ruff — 双引号、4 空格缩进、行宽 120
- **Lint**：ruff check — E/W/F/I/UP/B/SIM/RUF 规则集
- **类型检查**：pyright — typeCheckingMode=basic，conda env `funasr`
- **配置**：`pyproject.toml`（项目根目录）
- **排除**：`asr/providers/gguf/qwen_asr_gguf/`（第三方 vendor 代码）

### Pre-commit Hooks

6 个本地 hooks，全部 `always_run: true, pass_filenames: false`：

| Hook        | 工具                   | 用途                |
| ----------- | ---------------------- | ------------------- |
| pyright     | pyright                | Python 类型检查     |
| ruff-check  | ruff check             | Python lint         |
| ruff-format | ruff format --check    | Python 格式检查     |
| eslint      | npx eslint .           | Vue/TS lint         |
| prettier    | npx prettier --check . | 前端格式检查        |
| vue-tsc     | npx vue-tsc --noEmit   | TypeScript 类型检查 |

**提交前根据变更文件执行对应检查，确保 hooks 通过再 commit：**

- 改了 `asr/` 下的 Python 文件 → `ruff check asr/` + `ruff format --check asr/` + `pyright`
- 改了前端/TypeScript 文件 → `pnpm lint` + `pnpm format:check` + `pnpm typecheck`
- 都改了 → 全部执行

## 技术栈

- Nuxt 4 + Vue 3 + TypeScript
- Nuxt UI v4 + Nuxt Icon (UI 组件库) + VueUse
- Nitro 内置 WebSocket（`nitro.experimental.websocket: true`）
- better-sqlite3（Node 端配置存储）
- Python ASR 后端（llama.cpp + ONNXRuntime + Silero VAD）
- pnpm (包管理器)

## 环境变量

参见 `.env.example`：

- `AI_BASE_URL` — OpenAI 兼容 API 地址（默认 `https://api.openai.com/v1`）
- `AI_API_KEY` — API 密钥
- `AI_MODEL_NAME` — 模型名称
- `ASR_PYTHON_PATH` — Python 解释器路径（不设则自动检测 conda env）
- `GGUF_MODEL_DIR` — 覆盖 GGUF 模型目录路径

## 架构

### 整体数据流

```
音频源 (FLV直播流 / 麦克风)
    │ ffmpeg → 16kHz mono PCM chunks
    ▼
Nuxt Server (transcription-manager.ts)
    │ WebSocket bridge → asr/server.py (port 9900)
    ▼
ASR Provider (GGUFProvider)
    │ Silero VAD → 句段切割 → ONNX Encoder + GGUF LLM Decoder
    │ → partial/final 结果
    ▼
Nuxt Server
    ├─→ ai-processor.ts (润色 + 翻译)
    ├─→ WebSocket broadcast → 前端展示
    └─→ transcription-state.ts (共享状态)
```

### 前后端通信

前端是纯展示层，不含业务逻辑。所有数据通过 WebSocket 推送和 REST API 获取。

**WebSocket**（`server/routes/ws.ts`）：

- 路径 `/api/ws`，服务端单向推送，客户端不发送消息
- 消息类型：`init`、`current`（实时字幕逐字输出）、`confirmed`（最终确认字幕）、`ai_processed`（AI 处理结果）、`clear`、`transcription_status`、`transcription_progress`、`connection_count`、`audio_source_command`
- 连接管理器在 `server/utils/websocket.ts`：`broadcast()` 发送给所有客户端

**REST API**（`server/routes/api/`）：

- `/api/status` — 获取模拟状态和连接数
- `/api/simulate/start|stop` — 模拟控制
- `/api/clear` — 清空字幕
- `/api/ws/send` — 广播自定义 WS 消息
- `/api/asr/config|service-health|service-start|service-stop` — ASR 后端管理
- `/api/ai/config` — AI 配置
- `/api/transcription/start|stop|audio-start|audio-stop|recognition-start|recognition-stop|switch-source` — 转录生命周期控制

**开发调试 API**（`server/routes/devapi/`，仅 `import.meta.dev` 生效，生产环境返回 404）：

- `/devapi/state` — 完整转录状态（当前字幕 + 所有已确认字幕 + 连接数）
- `/devapi/subtitles` — 已确认字幕列表；`?format=text` 返回纯文本格式

### 转录编排器（核心状态机）

`server/utils/transcription-orchestrator.ts` 是转录流程的核心控制器：

- 状态：`idle` → `starting` → `running` → `stopping` → `error`
- 启动流程：healthCheck → connectAndLoadModel → startAudioSource
- 断线恢复：`attemptRecovery()` 自动重连，失败则重启服务
- 支持独立启停音频源和识别模块（`startAudioOnly()`、`startRecognitionOnly()`）

### ASR 后端（Python）

独立运行的 Python WebSocket 服务（`asr/server.py`，端口 9900）：

- **Provider 系统**（`asr/providers/base.py`）：抽象基类 `ASRProvider`，当前唯一实现 `GGUFProvider`
- **GGUFProvider**（`asr/providers/gguf/provider.py`）：三阶段流水线 — Silero VAD 句段切割 → ONNX Encoder 音频编码 → llama.cpp GGUF LLM 解码
- **ModelManager**（`asr/model_manager.py`）：按需加载/卸载模型、空闲超时自动卸载、CUDA OOM 恢复
- **Protocol**（`asr/protocol.py`）：定义所有 WS 消息类型的 dataclass
- **配置**：`asr/config.yaml`（静态默认值）+ `asr/config_db.py`（SQLite 持久化动态配置，路径 `asr/data/config.db`）

### 音频源

`server/utils/audio-source/` 目录：

- `base.ts` — `AudioSource` 接口（start/stop/onAudio/onError/getStatus）
- `flv.ts` — FLV 直播流，通过 ffmpeg 转为 16kHz mono PCM，指数退避自动重连
- `mic.ts` — 麦克风输入（待实现）

### AI 处理

`server/utils/ai-processor.ts`：调用 OpenAI 兼容 API 进行文本润色和翻译。配置存储在 SQLite（`server/data/slt.db`），通过 `server/utils/ai-config.ts` 管理。

### 类型系统

共享类型定义在 `types/` 目录：

- `websocket.ts` — WS 消息类型和各消息的 data 类型
- `subtitle.ts` — `CurrentSubtitle`（实时）、`ConfirmedSubtitle`（确认）
- `asr.ts` — ASR 配置类型（camelCase ↔ snake_case 转换）
- `ai.ts` — AI 结果和配置类型
- `transcription.ts` — 转录状态类型
- `simulation.ts` — 模拟器全局状态

### 前端结构

**页面**：`pages/index.vue`（主展示页，中英双语并排）+ `pages/admin.vue`（控制面板）

**Composables**（`composables/`）：`useWebSocket`（WS 客户端，自动重连）、`useSubtitles`（字幕状态）、`useSettings`（主题/字号等设置）、`useScrollSync`、`useParagraphLogic`、`useFullscreen`、`useNotification`、`useAudioCapture`（麦克风录音）、`useWaveformRenderer`（波形渲染）、`useTranscription`（转录控制）

### 共享库

`lib/` 是指向 `../transcribe-service/lib` 的符号链接，包含与转录服务项目共享的代码。

### 启动方式

`start.sh` 一键启动：激活 conda env `trans` → 后台启动 ASR 服务 → 后台启动 Nuxt dev server → trap 信号清理

## 架构原则

1. **API 优先架构** — 前后端通过 REST/WebSocket API 分离。前端仅处理展示，不包含业务逻辑。
2. **实时优先** — 目标延迟 <500ms（从音频到文字显示）。使用 WebSocket 进行流传输。优雅处理网络中断。
3. **模块化 ASR 后端** — 通过统一接口支持多个 ASR 提供商。每个会话可配置后端选择。
4. **数据可靠性** — 所有转录会话可持久化存储。需要提供导出功能。
5. **简洁优先** — 避免过早抽象。仅实现已明确的功能。引入复杂性前需证明其必要性。

## 开发工作流

- `master` 为开发分支
- 功能分支命名：`###-feature-name`（如 `123-add-whisper-integration`）
- 合并前需检查是否符合架构原则

## 经验教训

详细记录见 `docs/experience/` 目录。

- **asyncio.Queue 跨线程通信** — `asyncio.Queue` 不是线程安全的，从 worker 线程调用 `put_nowait()` 不会唤醒 event loop 上的 `await get()`，消息会堆积直到 event loop 重新获得控制权。必须使用 `loop.call_soon_threadsafe(queue.put_nowait, item)`。详见 [docs/experience/asyncio-queue-thread-safety.md](docs/experience/asyncio-queue-thread-safety.md)。
