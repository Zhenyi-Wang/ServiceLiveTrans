# 统一转录控制设计

## 目标

将当前分散的 ASR 服务控制、音频源控制合并为一键式转录控制。用户只需选择音频源后点"开始"，程序自动完成链式启动；点"停止"自动完成链式停止。所有状态通过 WebSocket 实时推送，消除轮询。

## 背景

当前系统存在以下问题：

1. ASR 服务（Python 进程）和转录管理器（Node 端）的启停分散在两个面板，用户需要手动操作多个步骤
2. 前端 mic 在页面 mount 时自动开始采集，与后端转录状态无关
3. 对 mic/file 音频源，后端不追踪前端推送状态
4. 三个轮询定时器（`/api/asr/status` 3s、`/api/asr/service-health` 3s、`/api/status` 2s），数据重复且浪费

## 设计决策

| 决策         | 选择                                   | 原因                           |
| ------------ | -------------------------------------- | ------------------------------ |
| ASR 服务启动 | 全自动，用户不感知                     | 一键体验                       |
| 启动失败处理 | 每步独立重试（3 次，1s→2s→4s），不回滚 | 已成功的部分保持在线，方便重试 |
| 运行中切源   | 热切换，Bridge 不动                    | 不中断转录                     |
| 服务崩溃处理 | 暂停音频源，自动重连服务               | 自动恢复                       |
| 停止范围     | 全部停止（音频源 + Bridge + ASR 服务） | 最干净的状态                   |
| 状态推送     | 全部走 WebSocket，无轮询               | 实时、架构干净                 |

## 场景

### 场景 1：冷启动（全部离线）

```
用户选源 → 点"开始" → 健康检查 → 启动 ASR 服务 → 轮询健康直到 OK → 连接 Bridge → 等待模型就绪 → 启动音频源 → running
```

### 场景 2：热启动（服务已在线）

健康检查通过，跳过"启动服务"，从连接 Bridge 开始。

### 场景 3：运行中切换音频源

热切换机制（后端协调，分两种情况）：

**stream 源切换**（涉及后端音频源）：

- stream → stream：后端停止旧 FLVSource → 启动新 FLVSource
- stream → mic/file：后端停止 FLVSource → 通知前端启动采集/播放

**前端源切换**（仅涉及前端采集）：

- mic → file：通知前端停止 mic 采集 → 启动文件播放
- mic → mic：通知前端重启 mic 采集（切换设备时）
- file → mic：通知前端停止文件播放 → 启动 mic 采集

Bridge 在所有热切换场景中保持连接。

### 场景 4：停止

通知前端停止音频源 → 断开 Bridge → 停止 ASR 服务 → idle。

### 场景 5：运行中 ASR 服务崩溃

暂停音频源（通知前端停止采集）→ 状态设为 `starting`（复用启动状态表示恢复中）→ 推送 `transcription-status`（`recognition.active = false, recognition.detail = '服务断开，正在恢复...'`）→ 自动重连 Bridge → 如果服务已死则重启服务 → 重连成功后恢复音频源（通知前端重新启动采集）→ 状态回到 `running`。

### 场景 6：启动失败（重试耗尽）

进入 error 状态，显示具体错误原因。Orchestrator 内部追踪哪些步骤已完成（`completedSteps: Set<string>`），已成功的步骤保持在线。用户可点"重新开始"复用已在线组件。

## 后端设计

### 统一状态机

```
idle → starting → running → stopping → idle
                 ↘ error ↗
```

状态定义：

- `idle` — 全部停止
- `starting` — 链式启动中（重试期间也保持 starting）
- `running` — 正常转录
- `stopping` — 链式停止中
- `error` — 某步失败且重试耗尽

### 类型系统变更（`types/websocket.ts`）

需要修改/新增的类型：

```typescript
// 扩展 WSMessageType 联合类型
type WSMessageType = ... | 'transcription-status' | 'transcription-progress' | 'connection-count' | 'audio-source-start' | 'audio-source-stop'

// 废弃现有 'status' 消息类型，由 'transcription-status' 替代
// transcription-manager.ts 中的 _broadcastStatus() 改为发送 'transcription-status'
// 现有 WSStatusData 和 WSStatusMessageType 标记为 @deprecated，过渡期后删除

// 废弃现有 TranscriptionStateType（包含 'reconnecting'），由 TranscriptionStatusData.state 替代
// 'reconnecting' 语义合并到 'starting'（自动恢复时 Orchestrator 将状态设为 starting）
type TranscriptionStateType = 'idle' | 'starting' | 'running' | 'error' | 'reconnecting' // @deprecated

// 扩展 WSMessage.data 联合类型
interface WSMessage {
  type: WSMessageType
  data?: WSInitData | WSConfirmedData | WSCurrentData | TranscriptionStatusData | TranscriptionProgressData | ConnectionCountData | AudioSourceCommandData | AudioSourceStopData | WSAIProcessedData | null
}

// 扩展 WSInitData
interface WSInitData {
  current: string | null
  confirmed: ConfirmedSubtitle[]
  transcriptionStatus: TranscriptionStatusData  // 新增
  connectionCount: number                        // 新增
}

// 新增类型
interface TranscriptionStatusData {
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  audio: { active: boolean; label: string; detail?: string }
  recognition: { active: boolean; detail?: string }
  error?: string
  uptime: number
}

interface TranscriptionProgressData {
  step: 'health-checking' | 'health-ok' | 'service-starting' | 'service-ready' | 'bridge-connecting' | 'bridge-connected' | 'model-loading' | 'model-ready' | 'source-starting' | 'source-ready' | 'stopping-source' | 'stopping-bridge' | 'stopping-service'
}

interface ConnectionCountData {
  count: number
}

interface AudioSourceCommandData {
  source: 'mic' | 'file' | 'stream'
}

interface AudioSourceStopData {}
```

### Orchestrator 与 transcription-manager 的关系

采用方案 (c)：**重构 transcription-manager 使其成为 Orchestrator 的内部实现**。

当前 `transcription-manager.ts` 承担了太多职责（Bridge 连接、音频源管理、ASR 结果处理、状态广播）。重构为：

- `transcription-orchestrator.ts`（新增）— 对外公开 API，负责链式编排、重试、状态推送
- `transcription-manager.ts`（重构）— 内部模块，只负责 Bridge 连接/断开、音频转发、ASR 结果处理。将其私有函数（`bridgeConnect`、`bridgeDisconnect`、`sendAudioChunkToASR`）改为通过新增的公开方法暴露给 Orchestrator 调用

Orchestrator 调用 transcription-manager 的公开方法：

- `manager.connectBridge(config)` — 连接 ASR Bridge
- `manager.disconnectBridge()` — 断开 Bridge
- `manager.sendAudioChunk(data)` — 转发音频
- `manager.isBridgeConnected()` — 查询 Bridge 状态
- `manager.onReady(callback)` — 注册模型就绪回调
- `manager.stopStreamSource()` — 停止 stream 音频源（仅 stream 源时有效）
- `manager.getStatus()` — 获取内部状态

### 启动编排器（Orchestrator）

在 `server/utils/` 新增 `transcription-orchestrator.ts`，作为系统唯一的对外入口，负责：

1. **链式启动**：按顺序执行各步骤，每步完成后通过 WS 推送 `transcription-progress`
2. **重试逻辑**：每步独立重试，指数退避（1s→2s→4s），重试期间状态保持 `starting`
3. **步骤追踪**：内部维护 `completedSteps: Set<string>`，记录已完成的步骤，重试时跳过
4. **热切换**：运行中切换音频源，不影响 Bridge
5. **自动恢复**：服务崩溃时自动重连

启动链路步骤：

1. **探测性健康检查**（`GET http://127.0.0.1:9900/health`）→ 推送 `health-checking`。此步骤是探测性的，失败不触发重试，直接进入步骤 2。成功则推送 `health-ok` 并跳过步骤 2
2. 如果步骤 1 失败，启动服务（复用 `asr-process.ts` 的 `startASRProcess()`）→ 推送 `service-starting`。启动后轮询健康检查直到 OK → 推送 `service-ready`。此步骤独立重试（3 次）
3. 连接 Bridge → 推送 `bridge-connecting` / `bridge-connected`
4. 等待模型就绪 → 推送 `model-loading` / `model-ready`
5. 对于 stream 源：启动 FLVSource。对于 mic/file 源：推送 `audio-source-start` 指令通知前端 → 推送 `source-starting` / `source-ready`

停止链路步骤：

1. 推送 `audio-source-stop` 通知前端停止采集/播放；对 stream 源同时调用 `manager.stopStreamSource()` → 推送 `stopping-source`
2. 调用 `manager.disconnectBridge()` → 推送 `stopping-bridge`
3. 调用 `stopASRProcess()` → 推送 `stopping-service`

### API 变更

**新增：**

- `POST /api/transcription/start` — 一键启动，body: `{ source, streamUrl?, provider?, overlapSec?, memoryChunks? }`
- `POST /api/transcription/stop` — 一键停止
- `POST /api/transcription/switch-source` — 热切换音频源，body: `{ source, streamUrl? }`

**废弃（标记 @deprecated，过渡期后删除）：**

- `POST /api/asr/start` — 由 `/api/transcription/start` 替代
- `POST /api/asr/stop` — 由 `/api/transcription/stop` 替代
- `GET /api/asr/status` — 由 WS `transcription-status` 推送替代
- `GET /api/asr/service-health` — 由 WS `transcription-status` 推送中的 recognition 组件状态替代
- `GET /api/status` — 保留用于模拟器场景（详见下方说明）

**保留：**

- `POST /api/asr/service-start` — 高级面板单独控制用
- `POST /api/asr/service-stop` — 高级面板单独控制用
- `GET /api/asr/config` — 高级面板获取默认配置用
- `GET /api/status` — **保留**，模拟器仍依赖此端点。AdminStatusPanel 的模拟器状态数据继续从此获取，但连接数和转录相关数据改为从 WS 推送获取

### WebSocket 消息变更

**废弃现有 `status` 消息类型：**

当前 `transcription-manager.ts:212` 的 `_broadcastStatus()` 发送 `{ type: 'status', ... }`。废弃此消息类型，统一改为发送 `transcription-status`。`types/websocket.ts` 中的 `WSStatusMessageType` 和 `WSStatusData` 标记 `@deprecated`。

**新增消息类型：**

```typescript
// 转录状态推送（状态变化时发送）
{ type: 'transcription-status', data: TranscriptionStatusData }

// 转录进度推送（链式启动/切换/停止的每步完成时发送）
{ type: 'transcription-progress', data: TranscriptionProgressData }

// 连接数变化推送
// 触发时机：websocket.ts 的 addConnection() 和 removeConnection() 中调用 broadcast
{ type: 'connection-count', data: ConnectionCountData }
```

**修改 init 消息：**

`server/routes/api/ws.ts` 的 `open` handler 中，`init` 消息增加 `transcriptionStatus` 和 `connectionCount` 字段（见上方 `WSInitData` 扩展）。

**前端音频源启动指令（后端→前端）：**

```typescript
// 前端自行保存音频配置（设备ID、采样率、音量等），此指令仅触发启动动作
{ type: 'audio-source-start', data: AudioSourceCommandData }
{ type: 'audio-source-stop', data: AudioSourceStopData }  // 不携带 source，后端和前端各自知道当前源
```

## 前端设计

### 面板合并

合并 `ASRControlPanel` + `ModelStatusPanel` 为 `TranscriptionControlPanel`。删除这两个旧组件。

### AdminStatusPanel 变更

`AdminStatusPanel` 的数据来源拆分：

- **模拟器状态**（isActive）：继续从 `GET /api/status` 获取（保留轮询或由模拟器自行推送）
- **连接数**（connectionCount）：从 WS `connection-count` 消息获取
- **字幕数**（subtitleCount）：前端自行维护计数（每收到 `confirmed` 消息 +1）

### UI 结构

```
┌──────────────────────────────────┐
│  转录控制                         │
│                                  │
│  ── 音频源 ─────────────────────  │
│  [麦克风]  [文件]  [流]           │
│  ┌─ 源配置区域 ──────────────┐   │
│  │ (mic: 设备/波形/音量)      │   │
│  │ (file: 文件选择/进度/波形)  │   │
│  │ (stream: 流地址)           │   │
│  └───────────────────────────┘   │
│                                  │
│  ── 状态 ─────────────────────── │
│  ● 转录中          00:05:32     │
│  音频    ● 麦克风采集中          │
│  识别    ● 运行中                │
│                                  │
│  [      停止转录      ]          │
│                                  │
│  ▸ 高级                          │
└──────────────────────────────────┘
```

### 状态展示规则

| 总状态   | 音频状态                       | 识别状态      | 按钮文字  |
| -------- | ------------------------------ | ------------- | --------- |
| idle     | 已停止                         | 已停止        | 开始转录  |
| starting | 等待中/启动中                  | 启动中/加载中 | 启动中... |
| running  | 麦克风采集中/文件播放中/拉流中 | 运行中        | 停止转录  |
| error    | (视情况)                       | (错误原因)    | 重新开始  |
| stopping | 停止中                         | 停止中        | 停止中... |

### 高级区域（折叠）

- 引擎选择（provider）
- 采样率、分块大小、重叠、记忆块数
- 服务控制：识别服务 [启动]/[停止]（仅 idle/error 状态可操作）

### 关键行为

- 源切换在运行中可用，点击后发送 `POST /api/transcription/switch-source`，后端协调热切换
- 错误后可重试，复用已在线组件
- 前端不再在 mount 时自动启动 mic。设备枚举等初始化逻辑仍在 mount 时执行，但音频采集等待后端 `audio-source-start` 指令
- 音频配置参数（设备ID、采样率、音量、回声消除等）保存在前端组件内部，`audio-source-start` 指令仅触发启动动作，不携带配置参数

### index.vue（展示页）变更

`useSubtitles` 的 `handleMessage` 只处理 `init`、`current`、`confirmed`、`ai-processed`、`clear`。修改后的 `init` 消息新增了 `transcriptionStatus` 和 `connectionCount` 字段，但 `useSubtitles` 继续只提取 `current` 和 `confirmed`，忽略新增字段。新增字段的处理由 `useTranscription` composable 负责。

`index.vue` 不需要引入 `useTranscription`，因为它不需要转录控制功能。

## composable 变更

### 新增 useTranscription composable

管理转录状态，是 TranscriptionControlPanel 的核心 composable：

```typescript
function useTranscription() {
  // 响应式状态
  const state: Ref<'idle' | 'starting' | 'running' | 'stopping' | 'error'>
  const audio: Ref<{ active: boolean; label: string; detail?: string }>
  const recognition: Ref<{ active: boolean; detail?: string }>
  const error: Ref<string | undefined>
  const uptime: Ref<number>
  const connectionCount: Ref<number>
  const subtitleCount: Ref<number> // 前端自行维护

  // 操作方法
  async function startTranscription(config: { source: string; streamUrl?: string }): Promise<void>
  async function stopTranscription(): Promise<void>
  async function switchSource(config: { source: string; streamUrl?: string }): Promise<void>

  // WS 消息处理（注册到 useWebSocket 的 onMessage）
  function handleWSMessage(message: WSMessage): void
  // 处理类型：transcription-status、transcription-progress、connection-count、audio-source-start、audio-source-stop、confirmed（计数+1）

  // 音频源控制（由 WS 指令触发，不暴露给用户直接调用）
  function startAudioCapture(): void // 调用 useAudioCapture
  function stopAudioCapture(): void // 停止 useAudioCapture
  function startFilePlayback(): void // 调用 useAudioFilePlayer
  function stopFilePlayback(): void

  return {
    state,
    audio,
    recognition,
    error,
    uptime,
    connectionCount,
    subtitleCount,
    startTranscription,
    stopTranscription,
    switchSource,
  }
}
```

### useWebSocket 变更

`useWebSocket` 本身不增加消息处理逻辑。新消息类型由 `useTranscription.handleWSMessage()` 处理。`TranscriptionControlPanel` 在 mount 时将 `useTranscription.handleWSMessage` 注册到 `useWebSocket` 的 `onMessage` 回调中。

### 移除的轮询

- `ModelStatusPanel` 中的 `fetchStatus`（3s 轮询 `/api/asr/status`）— 组件删除
- `ModelStatusPanel` 中的 `fetchServiceHealth`（3s 轮询 `/api/asr/service-health`）— 组件删除
- `admin.vue` 中的 `fetchStatus`（2s 轮询 `/api/status`）— 如果模拟器仍需此轮询则保留，但转录相关数据改为从 WS 获取

## 文件变更清单

### 新增文件

- `server/utils/transcription-orchestrator.ts` — 链式编排器
- `server/routes/api/transcription/start.ts` — 一键启动 API
- `server/routes/api/transcription/stop.ts` — 一键停止 API
- `server/routes/api/transcription/switch-source.ts` — 热切换 API
- `components/admin/TranscriptionControlPanel.vue` — 合并后的转录控制面板
- `composables/useTranscription.ts` — 转录状态管理 composable

### 重构文件

- `server/utils/transcription-manager.ts` — 暴露公开方法供 Orchestrator 调用，废弃 `_broadcastStatus()` 改为发送 `transcription-status`
- `server/routes/api/ws.ts` — 增强 `init` 消息，增加 `connection-count` 广播触发
- `server/utils/websocket.ts` — `addConnection`/`removeConnection` 中触发 `connection-count` 广播
- `types/websocket.ts` — 新增/修改类型定义

### 删除文件

- `components/admin/ASRControlPanel.vue` — 合并到 TranscriptionControlPanel
- `components/admin/ModelStatusPanel.vue` — 合并到 TranscriptionControlPanel
- `server/routes/api/asr/start.ts` — 由 transcription/start 替代
- `server/routes/api/asr/stop.ts` — 由 transcription/stop 替代

### 修改文件

- `pages/admin.vue` — 替换面板组件引用，移除转录相关轮询，调整状态管理
- `pages/index.vue` — 无需修改（init 新字段被 useSubtitles 忽略）
- `composables/useWebSocket.ts` — 无需修改（消息处理委托给 useTranscription）
- `composables/useAudioCapture.ts` — 现有文件，由 useTranscription 调用，无需修改
- `composables/useAudioFilePlayer.ts` — 现有文件，由 useTranscription 调用，无需修改
