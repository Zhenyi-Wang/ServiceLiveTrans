# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ServiceLiveTrans 是一个实时语音转录服务，支持直播源和麦克风输入。功能包括网页后台控制、聚会预约和转录稿存储。

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
- pnpm (包管理器)

## 架构

### 前后端通信

前端是纯展示层，不含业务逻辑。所有数据通过 WebSocket 推送和 REST API 获取。

**WebSocket**（`server/routes/api/ws.ts`）：

- 路径 `/api/ws`，服务端单向推送，客户端不发送消息
- 消息类型：`init`（连接时发送当前状态）、`current`（实时字幕逐字输出）、`confirmed`（最终确认字幕，含 AI 优化和翻译）、`clear`
- 连接管理器在 `server/utils/websocket.ts`：`broadcast()` 发送给所有客户端，`sendTo()` 发送给单个客户端

**REST API**（`server/routes/api/`）：

- `GET /api/status` — 获取模拟状态和连接数
- `POST /api/simulate/start` — 启动模拟（可选 `delay` 参数 500-10000ms）
- `POST /api/simulate/stop` — 停止模拟
- `POST /api/clear` — 清空字幕
- `POST /api/ws/send` — 广播自定义 WS 消息（管理后台用）

### 类型系统

共享类型定义在 `types/` 目录：

- `websocket.ts` — `WSMessage`、`WSMessageType`、各消息的 data 类型
- `subtitle.ts` — `CurrentSubtitle`（实时）、`ConfirmedSubtitle`（确认）
- `simulation.ts` — `SimulationState`（模拟器全局状态）

### 前端结构

**页面**（`pages/`）：

- `index.vue` — 主展示页，中英双语字幕并排显示，各自支持独立全屏
- `admin.vue` — 管理后台，模拟控制 + WS 事件测试面板 + 实时状态

**组件**（`components/`）按 Nuxt 自动导入命名：

- `components/layout/` — AppHeader、SettingsDrawer
- `components/content/` — Section、ParagraphDisplay、CurrentInput 等
- `components/admin/` — TranscriptionControlPanel
- `components/common/` — ConnectionStatus、Notification

**Composables**（`composables/`）：

- `useWebSocket` — WS 客户端，自动重连（每 3 秒，最多 10 次）
- `useSubtitles` — 字幕状态管理，路由 WS 消息到对应状态
- `useSettings` — 主题、字号、自动滚动、段落长度等设置
- `useScrollSync` — 中英文面板滚动同步
- `useParagraphLogic` — 按长度将段落分组
- `useFullscreen` — 中英文区域独立全屏
- `useNotification` — Toast 通知队列

### 后端结构

- `server/routes/api/` — REST 路由和 WebSocket 处理器
- `server/utils/simulator.ts` — 模拟引擎，管理全局 `simulationState`
- `server/utils/websocket.ts` — WS 连接管理（活跃连接集合 + 广播）
- `server/utils/sample-data.ts` — 20 条双语示例句子

## 架构原则

1. **API 优先架构** — 前后端通过 REST/WebSocket API 分离。前端仅处理展示，不包含业务逻辑。
2. **实时优先** — 目标延迟 <500ms（从音频到文字显示）。使用 WebSocket 进行流传输。优雅处理网络中断。
3. **模块化 ASR 后端** — 通过统一接口支持多个 ASR 提供商（Whisper、FunASR）。每个会话可配置后端选择。
4. **数据可靠性** — 所有转录会话可持久化存储。需要提供导出功能。
5. **简洁优先** — 避免过早抽象。仅实现已明确的功能。引入复杂性前需证明其必要性。

## 开发工作流

- `master` 为开发分支
- 功能分支命名：`###-feature-name`（如 `123-add-whisper-integration`）
- 合并前需检查是否符合架构原则

### Superpowers 工作流

本项目使用 superpowers 插件进行规格驱动开发。

## 经验教训

详细记录见 `docs/experience/` 目录。

- **asyncio.Queue 跨线程通信** — `asyncio.Queue` 不是线程安全的，从 worker 线程调用 `put_nowait()` 不会唤醒 event loop 上的 `await get()`，消息会堆积直到 event loop 重新获得控制权。必须使用 `loop.call_soon_threadsafe(queue.put_nowait, item)`。详见 [docs/experience/asyncio-queue-thread-safety.md](docs/experience/asyncio-queue-thread-safety.md)。
