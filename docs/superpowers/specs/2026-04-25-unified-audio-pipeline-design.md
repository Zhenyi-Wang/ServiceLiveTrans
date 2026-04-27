# 统一音频管道设计

## 目标

将当前分裂的 `asr-bridge` + `liveTransManager` 两套管理系统统一为一个 `TranscriptionManager`。所有音频源（mic、file、stream）对 ASR 后端来说都是音频片段，Node 后端可实时切换来源。

## 当前问题

### 两套管理系统

| 系统       | 管理模块              | 音频来源            | 适用场景  |
| ---------- | --------------------- | ------------------- | --------- |
| ASR Bridge | `asr-bridge.ts`       | 前端 WebSocket 推送 | mic、file |
| LiveTrans  | `liveTransManager.ts` | 后端 FLVSource 拉取 | stream    |

两者各自维护独立的 ASR WebSocket 连接、独立的状态管理、独立的 transcriptionState 修改。`asr/start.ts` 里 stream 源临时调用了 `liveTransManager.start()`，是一种补丁而非真正的统一。

### 具体问题

1. **互斥检查不完整**：ASRControlPanel 检查 LiveTrans 是否运行，但 LiveTransControl 不检查 ASR
2. **MicSource 未实现**：`mic.ts` 是占位符，但接口和路由声明支持
3. **stop 竞态**：`asr/stop.ts` 无条件调用 `stopASRProcess()`，可能误杀 live 模式的进程
4. **confirmedSubtitles 不清空**：`liveTransManager.stop()` 遗漏清空
5. **状态不一致**：`asr-bridge` 的 `status` 和 `liveTransManager` 的 `state` 可能不同步
6. **前端面板重叠**：ASRControlPanel 的 Stream 模式和 LiveTransControl 功能完全相同

## 设计

### 核心原则

- **单一管理者**：一个 `TranscriptionManager` 负责所有音频源的生命周期
- **ASR 连接共享**：所有源共用一个 ASR Bridge WebSocket 连接
- **来源透明**：ASR 后端只收到 `sendAudioChunk(base64Pcm)`，不知道也不关心来源
- **来源可切换**：运行中可以切换音频源（先停旧源再启新源，ASR 连接不断）

### 架构

```
                    ┌─────────────────────────────────────────┐
                    │          TranscriptionManager            │
                    │                                         │
                    │  ┌───────────┐   ┌───────────────────┐  │
                    │  │ ASR Bridge │   │   AudioSource     │  │
                    │  │ (单一连接) │◄──│ ┌───────────────┐ │  │
                    │  │           │   │ │ WebSocketSource│ │  │
                    │  │ sendAudio │   │ │ (mic/file)    │ │  │
                    │  │  Chunk()  │   │ └───────────────┘ │  │
                    │  │           │   │ ┌───────────────┐ │  │
                    │  │ onResult  │   │ │ FLVSource     │ │  │
                    │  │  →broadcast│  │ │ (stream)      │ │  │
                    │  └───────────┘   │ └───────────────┘ │  │
                    │                  └───────────────────┘  │
                    └─────────────────────────────────────────┘
```

### 音频数据流

**mic/file（前端推送）**：

```
浏览器 AudioCapture/FilePlayer → WS {type:"audio"} → 服务端 ws.ts
  → TranscriptionManager.sendAudioChunk(base64Pcm) → ASR Bridge → ASR 服务
```

**stream（后端拉取）**：

```
FLVSource (ffmpeg) → pcm Buffer → TranscriptionManager.sendAudioChunk(base64Pcm) → ASR Bridge → ASR 服务
```

### 组件设计

#### 1. TranscriptionManager（新建，替代 asr-bridge + liveTransManager）

文件：`server/utils/transcription-manager.ts`

职责：

- 管理唯一的 ASR Bridge WebSocket 连接
- 管理当前活跃的 AudioSource（server-side）
- 提供统一的 start/stop/switchSource 接口
- 维护 transcriptionState
- 处理 ASR 结果广播

接口：

```typescript
type SourceType = 'mic' | 'file' | 'stream'

interface StartConfig {
  provider: string
  model: string
  source: SourceType
  streamUrl?: string
}

interface TranscriptionStatus {
  state: 'idle' | 'starting' | 'running' | 'error'
  source: SourceType | null
  asrConnected: boolean
  asrProvider: string | null
  sourceStatus?: AudioSourceStatus
  error?: string
}

// 统一管理器
export const transcriptionManager = {
  start(config: StartConfig): Promise<boolean>,
  stop(): void,
  sendAudioChunk(base64Pcm: string): boolean,  // 前端推送的音频
  getStatus(): TranscriptionStatus,
  setOnReadyCallback(cb: (() => void) | null): void,
}
```

关键行为：

- `start('mic' | 'file')`：只连接 ASR Bridge，不创建 server-side AudioSource。音频由前端通过 WebSocket 推送。
- `start('stream')`：连接 ASR Bridge + 创建 FLVSource 拉流。
- `stop()`：断开 ASR Bridge + 停止 server-side AudioSource + 清空 transcriptionState。
- `sendAudioChunk()`：ws.ts 调用此方法将前端音频转发给 ASR。如果 ASR 未连接则丢弃。
- ASR 结果通过 `broadcast()` 推送给所有客户端（保持现有行为）。

#### 2. ASR Bridge（重构，从独立模块变为 TranscriptionManager 内部）

不再导出独立的 `startASR/stopASR/sendAudioChunk`。WebSocket 连接管理内聚到 TranscriptionManager 中。

- `connect()`：创建到 ASR 服务的 WebSocket 连接
- `disconnect()`：关闭连接
- `sendAudioChunk(base64Pcm)`：发送音频数据
- `sendConfig(provider, model)`：发送模型配置
- `onMessage`：处理 partial/final/ready/error 等消息

#### 3. AudioSource 接口（保持不变）

```typescript
// server/utils/audio-source/base.ts
interface AudioSource {
  start(): Promise<void>
  stop(): void
  onAudio(cb: (pcm: Buffer) => void): void
  onError(cb: (error: Error) => void): void
  getStatus(): AudioSourceStatus
}
```

- `AudioSourceType` 扩展为 `'flv' | 'stream'`（保持 `flv` 作为内部标识）
- MicSource 暂不实现（mic 音频始终由前端推送）

#### 4. WebSocket handler（修改 ws.ts）

```typescript
// 当前
if (data.type === 'audio' && data.data) {
  sendAudioChunk(data.data)
}

// 改为
if (data.type === 'audio' && data.data) {
  transcriptionManager.sendAudioChunk(data.data)
}
```

### API 路由变更

#### 统一 API（替代 asr/start + live/start）

保留现有 API 路径以保持兼容，但内部都委托给 `transcriptionManager`：

**`POST /api/asr/start`**（保留）：

- `source: 'mic' | 'file'` → `transcriptionManager.start()`，不创建 server-side 音频源
- `source: 'stream'` → `transcriptionManager.start()`，创建 FLVSource

**`POST /api/asr/stop`**（保留）：

- 统一调用 `transcriptionManager.stop()` + `stopASRProcess()`
- 移除对 `liveTransManager` 的条件判断

**`POST /api/live/start`**（保留）：

- 委托给 `transcriptionManager.start({ source: 'stream', sourceType: 'flv' })`
- 保持向后兼容

**`POST /api/live/stop`**（保留）：

- 委托给 `transcriptionManager.stop()`

**`GET /api/asr/status`**（修改）：

- 返回 `transcriptionManager.getStatus()`
- 合并原来分散在 asr-bridge 和 liveTransManager 的状态

### 前端变更

#### 合并控制面板

将 `ASRControlPanel` 和 `LiveTransControl` 合并为一个统一的 `TranscriptionControlPanel`：

- 三种源选项：Microphone、File、Stream
- Stream 源显示 URL 输入框
- 统一的启动/停止按钮
- 统一的状态显示（ASR 连接状态 + 音频源状态）

从 `admin.vue` 中移除 `LiveTransControl` 组件，只保留合并后的面板。

#### admin.vue 简化

```typescript
// 移除
const asrIsRunning = ref(false)
const asrIsLoading = ref(false)
const liveIsRunning = ref(false)
const liveIsLoading = ref(false)

// 统一为
const transIsRunning = ref(false)
const transIsLoading = ref(false)

const handleStart = async (config) => { ... }
const handleStop = async () => { ... }
```

### 删除的文件

- `server/utils/live-trans-manager.ts` — 功能合并到 transcription-manager.ts
- `components/admin/LiveTransControl.vue` — 功能合并到 ASRControlPanel

### 保留的文件

- `server/utils/audio-source/base.ts` — 接口不变
- `server/utils/audio-source/flv.ts` — 实现不变
- `server/utils/audio-source/mic.ts` — 暂保留占位符
- `server/utils/asr-process.ts` — 进程管理不变
- `server/routes/api/live/start.ts` — 保留但委托给 transcriptionManager
- `server/routes/api/live/stop.ts` — 保留但委托给 transcriptionManager
- `server/routes/api/live/status.ts` — 保留但委托给 transcriptionManager

### 不变的部分

- `transcription-state.ts` — 保持为共享状态单例
- `websocket.ts` — broadcast/sendTo 机制不变
- `asr-process.ts` — Python 进程管理不变
- `simulator.ts` — 模拟器独立，不受影响
- 前端 composables（useAudioCapture、useAudioFilePlayer）— 不变
- `pages/index.vue`（字幕展示页）— 不变

## 错误处理

- ASR 连接失败：3 秒后自动重连（保持现有行为）
- FLVSource 连接失败：指数退避重连（保持现有行为）
- 前端音频发送时 ASR 未连接：静默丢弃，不报错
- start 时已有活跃转录：返回 409
- 前端切换源：必须先停止当前转录再启动新源

## 状态广播

保持现有行为：ASR 的 partial/final 结果通过 `broadcast()` 推送给所有连接的客户端。

TranscriptionManager 状态变化（starting、running、error）通过 WebSocket 广播 `status` 消息，供前端实时更新 UI。
