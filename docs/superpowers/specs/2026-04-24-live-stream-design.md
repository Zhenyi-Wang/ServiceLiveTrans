# 直播流接入设计

## 概述

实现从 FLV 直播流拉取音频 → 实时转录 → AI 后处理 → 前端展示的全链路。为未来扩展（浏览器麦克风推流、预约启动）预留接口。

## 架构

```
┌────────────────────────────────────────────────────────────────┐
│                        Frontend (Nuxt)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 主展示页      │  │ 管理后台      │  │ (未来)麦克风推流页   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└────────────────────────────┬───────────────────────────────────┘
                             │ WebSocket + REST API
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                     Nuxt Server (Nitro)                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  LiveTransManager                        │   │
│  │  - 管理转录生命周期                                        │   │
│  │  - 协调 AudioSource → ASR Bridge → AI 后处理             │   │
│  │  - 重连策略、状态机                                        │   │
│  └──────────────┬───────────────────────────┬───────────────┘   │
│                 │                           │                    │
│     ┌───────────▼───────────┐   ┌───────────▼───────────┐       │
│     │    AudioSource         │   │    AIProcessor       │       │
│     │  ┌───────┐ ┌────────┐ │   │   (mock/real)       │       │
│     │  │ FLV   │ │  Mic   │ │   └─────────────────────┘       │
│     │  │Source │ │(预留)  │ │                                │
│     │  └───────┘ └────────┘ │                                │
│     └───────────┬───────────┘                                │
│                 │ onAudio callback                             │
│                 ▼                                              │
│         ┌─────────────┐                                       │
│         │ ASR Bridge  │ ──────▶ Python ASR (GGUF + Silero VAD)│
│         │ (现有)      │                                       │
│         └─────────────┘                                       │
└────────────────────────────────────────────────────────────────┘
```

## 模块设计

### 1. AudioSource 抽象接口

**文件**: `server/utils/audio-source/base.ts`

```typescript
type AudioSourceType = 'flv' | 'mic'

interface AudioSource {
  start(): Promise<void>
  stop(): void
  onAudio(cb: (pcm: Buffer) => void): void
  onError(cb: (error: Error) => void): void
  getStatus(): AudioSourceStatus
}

interface AudioSourceStatus {
  state: 'idle' | 'connecting' | 'running' | 'error'
  error?: string
  reconnectCount?: number
}
```

### 2. FLVSource 实现

**文件**: `server/utils/audio-source/flv.ts`

**核心逻辑**：
- FFmpeg 拉流：`ffmpeg -i {url} -vn -acodec pcm_s16le -ar 16000 -ac 1 -f s16le pipe:1`
- PCM 切片：每 100ms（3200 字节）触发一次 `onAudio` 回调
- 断线重连：指数退避 2s → 4s → 8s → 16s → 32s → 60s（封顶）

**重连策略**：
```typescript
private _scheduleReconnect() {
  const delay = Math.min(
    this.retryBase * Math.pow(2, this.retryCount),
    this.maxRetryDelay  // 60s
  )
  this.retryCount++
  this.retryTimer = setTimeout(() => this._connect(), delay)
}
```

**状态区分**：
- `stopped = true`：手动停止，不重连
- `stopped = false`：异常断开，触发重连

**错误通知**：
- 重连超过 10 次后，每次重连时通过 `onError` 回调通知
- 不设上限（FLV 流可能长时间不推送），但通过 WebSocket `status` 消息让前端展示重连状态

### 3. MicSource 预留接口

**文件**: `server/utils/audio-source/mic.ts`

预留接口，暂不实现。未来用于接收浏览器 WebSocket 推送的 PCM 数据。

考虑点：
- 采样率转换（浏览器可能不是 16kHz）
- 前端 AudioWorklet 或 MediaRecorder 采集

### 4. LiveTransManager

**文件**: `server/utils/live-trans-manager.ts`

**状态机**：

```
idle ──start()──▶ connecting ──connected──▶ running
  ▲                   │                        │
  │                   │ (连接失败)              │ (流断开)
  │                   ▼                        ▼
  │              reconnecting ◀────────────────┘
  │                   │
  │                   │ (手动停止)
  └───────────────────┘
```

**统一状态类型**（所有模块共享）：
```typescript
type LiveTransState = 'idle' | 'connecting' | 'running' | 'reconnecting'
```

**状态映射**：AudioSource 内部状态与 LiveTransState 的映射关系

| AudioSourceStatus.state | LiveTransState | 说明 |
|------------------------|----------------|------|
| `idle` | `idle` | 未启动 |
| `connecting` | `connecting` | 正在连接 |
| `running` | `running` | 正常运行 |
| `error` | `reconnecting` | 错误时触发重连，对外表现为 reconnecting |

**核心职责**：
- 协调 AudioSource 和 ASR Bridge 的生命周期
- 处理音频源和 ASR 不同时就绪的情况（pendingAudio 缓存）
- 状态变化广播到前端

**启动顺序**：
1. 连接 ASR Bridge（调用现有 `startASR()`）
2. 等待 ASR Bridge 发送 `ready` 消息
3. 创建并启动 AudioSource

**ASR Bridge 就绪通知**：现有 `asr-bridge.ts` 的 `ready` 消息只打印日志，需要添加回调机制：

```typescript
// asr-bridge.ts 改造
let onReadyCallback: (() => void) | null = null

export function setOnReadyCallback(cb: () => void) {
  onReadyCallback = cb
}

// ws.on('message') 中 ready 分支
else if (msg.type === 'ready') {
  console.log('[ASR Bridge] 模型就绪')
  if (onReadyCallback) onReadyCallback()
}
```

LiveTransManager 在启动时注册回调：
```typescript
setOnReadyCallback(() => {
  this.asrConnected = true
  // 发送 pendingAudio 中缓存的音频
  for (const pcm of this.pendingAudio) {
    sendAudioChunk(pcm.toString('base64'))
  }
  this.pendingAudio = []
})
```
4. 如果 ASR 先就绪但音频源未连接，ASR 处于等待状态（正常）
5. 如果音频源先就绪但 ASR 未连接，音频缓存在 pendingAudio

**数据流**：
```
FLVSource.onAudio(pcm)
  → LiveTransManager._onAudio(pcm)
    → sendAudioChunk(pcm.toString('base64'))  // asr-bridge.ts
      → Python ASR WebSocket
        → GGUF Provider → partial/final 结果
          → ASR Bridge.processResult()
            → broadcast({ type: 'confirmed' }) + processAI() 异步
              → broadcast({ type: 'ai-processed' })
```

**pendingAudio 缓存**：
```typescript
private pendingAudio: Buffer[] = []

private _onAudio(pcm: Buffer) {
  if (!this.asrConnected) {
    // ASR 未就绪，缓存音频（最多 10s）
    this.pendingAudio.push(pcm)
    if (this._pendingAudioDuration() > 10) {
      this.pendingAudio.shift()
    }
    return
  }
  sendAudioChunk(pcm.toString('base64'))
}
```

```typescript
private _pendingAudioDuration(): number {
  // 每个 Buffer 是 100ms (3200 bytes @ 16kHz s16le)
  return this.pendingAudio.length * 0.1
}
```

**注意**：pendingAudio 是降级策略。ASR 未就绪超过 10s 的音频会被丢弃，导致开头部分转录缺失。这是预期行为。

**单例模式**：LiveTransManager 使用模块级单例（与现有 asr-bridge.ts 一致），同时只允许一个转录会话。

### 5. AI 后处理

**文件**: `server/utils/ai-processor.ts`

**类型定义**（`types/ai.ts`）：
```typescript
interface AIResult {
  optimizedText: string
  enText: string
}
```

**Mock 实现**：
```typescript
async function mockProcess(text: string): Promise<AIResult> {
  // 随机延迟 500-1500ms
  await delay(500 + Math.random() * 1000)

  return {
    optimizedText: `润色：${text}`,
    enText: `翻译：${text}`
  }
}
```

**开关控制**：
```typescript
let useMockAI = true  // 默认开启

export function setMockAI(enabled: boolean) {
  useMockAI = enabled
}
```

**集成方式**（修改 `asr-bridge.ts` 的 `processResult`）：

收到 ASR final 结果后，分两步广播：

1. **立即广播 `confirmed`**：原始文本，`optimizedText` 和 `enText` 为空字符串
2. **异步广播 `ai-processed`**：AI 处理完成后，发送新消息类型

```typescript
// asr-bridge.ts processResult() 中 final 分支
if (result.type === 'final') {
  const id = `asr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`

  // 第一步：立即广播原始文本
  broadcast({ type: 'confirmed', data: { id, text: result.text, optimizedText: '', enText: '' } })
  broadcast({ type: 'current', data: { text: '', enText: '', version: 0, enVersion: 0 } })

  // 第二步：异步 AI 处理
  processAI(result.text).then(ai => {
    broadcast({ type: 'ai-processed', data: { id, optimizedText: ai.optimizedText, enText: ai.enText } })
  })
}
```

前端收到 `ai-processed` 消息后，根据 `id` 找到对应的 confirmed 字幕并更新。

### 6. Python ASR 前置静音过滤

**文件**: `asr/providers/gguf/provider.py`

在 `_process_loop` 中，`np.frombuffer` 之后、`np.concatenate` 之前插入前置 VAD 过滤：

```python
audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

# 前置静音过滤（使用独立 state，不影响主 VAD 分段逻辑）
# 条件：buffer 为空（当前无待处理音频）且当前帧为纯静音
# 目的：跳过长时间静音，避免无效音频进入 ASR 引擎
# 注意：buffer 不为空时，静音帧仍需进入（用于触发 VAD 分段逻辑）
if len(buffer) == 0 and len(audio) >= VAD_CHUNK_SIZE:
    aligned = audio[:(len(audio) // VAD_CHUNK_SIZE) * VAD_CHUNK_SIZE]
    # 使用临时 state 计算（类似 _find_last_silence_gap）
    temp_state = np.zeros((2, 1, 128), dtype=np.float32)
    temp_context = np.zeros((1, VAD_CONTEXT_SIZE), dtype=np.float32)
    all_silence = True
    for i in range(0, len(aligned), VAD_CHUNK_SIZE):
        chunk = aligned[i:i + VAD_CHUNK_SIZE].reshape(1, -1)
        x = np.concatenate([temp_context, chunk], axis=1)
        out, temp_state = self._vad_session.run(
            None,
            {"input": x, "state": temp_state, "sr": np.array(SAMPLE_RATE, dtype=np.int64)},
        )
        temp_context = chunk[:, -VAD_CONTEXT_SIZE:]
        if float(out[0][0]) >= self.vad_threshold:
            all_silence = False
            break
    if all_silence:
        continue  # 跳过纯静音，不进入 buffer

buffer = np.concatenate([buffer, audio])
```

**效果**：
- 纯静音段（buffer 为空时）直接丢弃，不进 buffer
- 语音中的停顿仍然触发分段 flush（现有逻辑不变）
- 共享同一个 Silero VAD session，无额外开销

## API 端点

### 新增端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/live/start` | POST | 启动直播转录 |
| `/api/live/stop` | POST | 停止直播转录 |
| `/api/live/status` | GET | 获取状态 |
| `/api/live/ai-config` | GET/POST | 获取/设置 Mock AI 开关 |

**POST /api/live/start**：
```typescript
// Request
{ sourceType: 'flv' | 'mic', streamUrl?: string }
// streamUrl 为空时使用环境变量 FLV_STREAM_URL

// Response
{ success: true, sourceType: 'flv' }
```

**GET /api/live/status**：
```typescript
// Response
{
  state: LiveTransState,
  sourceType: 'flv' | 'mic' | null,
  reconnectCount: number,
  uptime: number  // 秒
}
```

**GET/POST /api/live/ai-config**：
```typescript
// GET Response
{ useMockAI: true }

// POST Request
{ useMockAI: false }

// POST Response
{ useMockAI: false }
```

### 废弃端点

以下端点由 `/api/live/*` 替代，实施时删除：

| 废弃端点 | 替代端点 |
|---------|---------|
| `POST /api/stream/start` | `POST /api/live/start` |
| `POST /api/stream/stop` | `POST /api/live/stop` |

`/api/asr/*` 端点保留，由 `LiveTransManager` 内部调用。

### WebSocket 消息扩展

新增 `status` 和 `ai-processed` 消息类型：

```typescript
type WSMessageType = 'init' | 'confirmed' | 'current' | 'clear' | 'status' | 'ai-processed'

// 直播转录状态变化通知
interface WSStatusData {
  state: LiveTransState
  error?: string
  reconnectCount?: number
}

// AI 后处理完成通知
interface WSAIProcessedData {
  id: string           // 对应的 confirmed 消息 ID
  optimizedText: string
  enText: string
}

// WSMessage 类型联合更新
interface WSMessage {
  type: WSMessageType
  data?: WSInitData | WSConfirmedData | WSCurrentData | WSStatusData | WSAIProcessedData | null
}
```

## 前端改动

### 新建组件

**文件**: `components/admin/LiveTransControl.vue`

**UI 布局**：
```
┌─────────────────────────────────────────┐
│ 直播转录                                 │
├─────────────────────────────────────────┤
│ 状态: ● 运行中                          │
│ 运行时长: 01:23:45                      │
│ 重连次数: 2                             │
│                                         │
│ Mock AI: [===○===] (开)                │
│                                         │
│ [启动直播转录]  [停止]                  │
└─────────────────────────────────────────┘
```

**状态对应的 UI**：

| 状态 | 显示 | 按钮状态 |
|------|------|---------|
| idle | 灰色圆点 "空闲" | 启动可用，停止禁用 |
| connecting | 黄色圆点 "连接中..." | 全部禁用 |
| running | 绿色圆点 "运行中" | 停止可用 |
| reconnecting | 橙色圆点 "重连中 (#N)" | 停止可用 |

### 修改文件

**`pages/admin.vue`**：添加 `AdminLiveTransControl` 组件。

**`composables/useSubtitles.ts`**：处理 `ai-processed` 消息，根据 `id` 更新 confirmed 字幕的 `optimizedText` 和 `enText`。

```typescript
// useSubtitles.ts handleMessage 中新增分支
case 'ai-processed':
  if (message.data && 'id' in message.data) {
    const data = message.data as WSAIProcessedData
    const existing = confirmedSubtitles.value.find(s => s.id === data.id)
    if (existing) {
      existing.optimizedText = data.optimizedText
      existing.enText = data.enText
    }
  }
  break
```

## 文件清单

### 新建文件

| 文件路径 | 描述 |
|---------|------|
| `server/utils/audio-source/base.ts` | AudioSource 抽象接口 |
| `server/utils/audio-source/flv.ts` | FLV 源实现 |
| `server/utils/audio-source/mic.ts` | Mic 源预留接口 |
| `server/utils/live-trans-manager.ts` | 直播转录管理器 |
| `server/utils/ai-processor.ts` | AI 后处理 |
| `server/routes/api/live/start.ts` | 启动端点 |
| `server/routes/api/live/stop.ts` | 停止端点 |
| `server/routes/api/live/status.ts` | 状态端点 |
| `server/routes/api/live/ai-config.ts` | Mock AI 配置端点 |
| `components/admin/LiveTransControl.vue` | 前端控制组件 |
| `types/ai.ts` | AIResult 类型定义 |

### 修改文件

| 文件路径 | 改动 |
|---------|------|
| `types/websocket.ts` | 新增 `status`、`ai-processed` 消息类型和 LiveTransState |
| `server/utils/asr-bridge.ts` | 集成 AI 后处理（final → confirmed + ai-processed） |
| `pages/admin.vue` | 添加 LiveTransControl 组件 |
| `composables/useSubtitles.ts` | 处理 `ai-processed` 消息 |
| `asr/providers/gguf/provider.py` | 添加前置静音过滤 |

### 删除文件

| 文件路径 | 原因 |
|---------|------|
| `server/utils/stream-manager.ts` | 被 `live-trans-manager.ts` + `audio-source/` 替代 |
| `server/routes/api/stream/start.ts` | 被 `/api/live/start` 替代 |
| `server/routes/api/stream/stop.ts` | 被 `/api/live/stop` 替代 |

## 配置

### 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `FLV_STREAM_URL` | `http://mini:8080/live/livestream.flv` | 默认 FLV 流地址 |
| `ASR_WS_URL` | `ws://localhost:9900` | Python ASR WebSocket 地址 |

### 固定参数

| 参数 | 值 | 描述 |
|------|-----|------|
| PCM 采样率 | 16kHz | FFmpeg 输出 |
| PCM 声道 | 单声道 | FFmpeg 输出 |
| PCM 格式 | s16le | 16-bit signed little-endian |
| 音频切片 | 100ms (3200 bytes) | 发送到 ASR 的粒度。计算：16000 Hz × 0.1s × 2 bytes/sample × 1 channel = 3200 bytes |
| 重连初始间隔 | 2s | 指数退避基数 |
| 重连最大间隔 | 60s | 指数退避封顶 |
| pendingAudio 最大缓存 | 10s | ASR 未就绪时的音频缓存（降级策略） |

## 预留扩展

### 浏览器麦克风推流

1. 前端 AudioWorklet 采集 PCM
2. WebSocket 发送到 `/api/mic` 端点
3. MicSource 接收并转发到 ASR

### 预约启动

1. 新建 `server/utils/scheduler.ts`
2. 配置存储（JSON 文件或数据库）
3. 定时任务启动/停止 LiveTransManager

## 测试计划

1. **单元测试**：FLVSource 重连逻辑、pendingAudio 缓存
2. **集成测试**：FLV → ASR → AI → WebSocket 全链路
3. **手动测试**：
   - 启动直播转录，观察状态变化（idle → connecting → running）
   - 断开 FLV 流，验证重连和前端状态更新（前端显示"重连中 (#N)"，重连成功后变为"运行中"）
   - 长时间静音，验证前置 VAD 过滤（ASR 日志无无效转录输出）
   - Mock AI 开关切换，验证 confirmed → ai-processed 流程（前端原始文本先显示，500-1500ms 后更新为润色/翻译）
4. **边界条件**：
   - FFmpeg 进程被手动 kill
   - ASR WebSocket 断开但 FLV 正常
   - 并发调用 start/stop
   - 长时间运行内存泄漏
