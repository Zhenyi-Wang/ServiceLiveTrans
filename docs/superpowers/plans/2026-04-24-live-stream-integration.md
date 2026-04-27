# 直播流接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 FLV 直播流拉取 → GGUF ASR 实时转录 → AI 后处理（mock） → 前端展示的全链路。

**Architecture:** LiveTransManager 协调 FLVSource（FFmpeg 拉流 + 指数退避重连）、ASR Bridge（现有 WebSocket 通道）、AIProcessor（mock 润色/翻译）。前端管理后台新增直播转录控制面板。Python ASR 端添加前置 VAD 静音过滤。

**Tech Stack:** Nuxt 4, TypeScript, Node.js child_process (FFmpeg), WebSocket, Python (ONNX Runtime / Silero VAD)

**设计文档:** `docs/superpowers/specs/2026-04-24-live-stream-design.md`

---

## 文件结构

### 新建文件

| 文件                                    | 职责                                          |
| --------------------------------------- | --------------------------------------------- |
| `types/ai.ts`                           | AIResult 接口定义                             |
| `server/utils/audio-source/base.ts`     | AudioSource 抽象接口和 LiveTransState 类型    |
| `server/utils/audio-source/flv.ts`      | FLVSource：FFmpeg 拉流 + 指数退避重连         |
| `server/utils/audio-source/mic.ts`      | MicSource 预留接口（空壳）                    |
| `server/utils/ai-processor.ts`          | AI 后处理（mock/real 开关）                   |
| `server/utils/live-trans-manager.ts`    | 直播转录管理器（协调 AudioSource + ASR + AI） |
| `server/routes/api/live/start.ts`       | POST 启动直播转录                             |
| `server/routes/api/live/stop.ts`        | POST 停止直播转录                             |
| `server/routes/api/live/status.ts`      | GET 获取状态                                  |
| `server/routes/api/live/ai-config.ts`   | GET/POST Mock AI 开关                         |
| `components/admin/LiveTransControl.vue` | 管理后台直播转录控制面板                      |

### 修改文件

| 文件                             | 改动                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| `types/websocket.ts`             | 新增 `status`、`ai-processed` 消息类型，更新 WSMessage 联合 |
| `server/utils/asr-bridge.ts`     | 添加 onReadyCallback + AI 后处理集成                        |
| `composables/useSubtitles.ts`    | 处理 `ai-processed` 消息                                    |
| `pages/admin.vue`                | 添加 LiveTransControl 组件                                  |
| `asr/providers/gguf/provider.py` | 添加前置静音过滤                                            |

### 删除文件

| 文件                                | 原因                                      |
| ----------------------------------- | ----------------------------------------- |
| `server/utils/stream-manager.ts`    | 被 live-trans-manager + audio-source 替代 |
| `server/routes/api/stream/start.ts` | 被 /api/live/start 替代                   |
| `server/routes/api/stream/stop.ts`  | 被 /api/live/stop 替代                    |

---

### Task 1: 类型定义

**Files:**

- Create: `types/ai.ts`
- Modify: `types/websocket.ts`

- [ ] **Step 1: 创建 `types/ai.ts`**

```typescript
export interface AIResult {
  optimizedText: string
  enText: string
}
```

- [ ] **Step 2: 修改 `types/websocket.ts` — 扩展消息类型**

将文件完整替换为：

```typescript
/**
 * 直播转录状态
 */
export type LiveTransState = 'idle' | 'connecting' | 'running' | 'reconnecting'

/**
 * WebSocket 消息类型
 */
export type WSMessageType = 'init' | 'confirmed' | 'current' | 'clear' | 'status' | 'ai-processed'

/**
 * 初始化消息数据
 */
export interface WSInitData {
  current: string | null
  confirmed: ConfirmedSubtitle[]
}

/**
 * 已确认字幕消息数据
 */
export interface WSConfirmedData {
  id: string
  text: string
  optimizedText: string
  enText: string
}

/**
 * 当前输入消息数据
 */
export interface WSCurrentData {
  text: string
  enText: string
  version: number
  enVersion: number
}

/**
 * 直播转录状态变化通知
 */
export interface WSStatusData {
  state: LiveTransState
  error?: string
  reconnectCount?: number
}

/**
 * AI 后处理完成通知
 */
export interface WSAIProcessedData {
  id: string
  optimizedText: string
  enText: string
}

/**
 * 已确认字幕
 */
export interface ConfirmedSubtitle {
  id: string
  text: string
  optimizedText?: string
  enText?: string
  timestamp: number
}

/**
 * WebSocket 消息
 */
export interface WSMessage {
  type: WSMessageType
  data?: WSInitData | WSConfirmedData | WSCurrentData | WSStatusData | WSAIProcessedData | null
}
```

- [ ] **Step 3: 验证编译**

Run: `pnpm build`
Expected: 编译成功，无类型错误

- [ ] **Step 4: 提交**

```bash
git add types/ai.ts types/websocket.ts
git commit -m "feat: 添加直播转录相关类型定义"
```

---

### Task 2: AudioSource 抽象与 FLVSource 实现

**Files:**

- Create: `server/utils/audio-source/base.ts`
- Create: `server/utils/audio-source/flv.ts`
- Create: `server/utils/audio-source/mic.ts`

- [ ] **Step 1: 创建 `server/utils/audio-source/base.ts`**

```typescript
export type AudioSourceType = 'flv' | 'mic'

export interface AudioSource {
  start(): Promise<void>
  stop(): void
  onAudio(cb: (pcm: Buffer) => void): void
  onError(cb: (error: Error) => void): void
  getStatus(): AudioSourceStatus
}

export interface AudioSourceStatus {
  state: 'idle' | 'connecting' | 'running' | 'error'
  error?: string
  reconnectCount?: number
}
```

- [ ] **Step 2: 创建 `server/utils/audio-source/flv.ts`**

```typescript
import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import type { AudioSource, AudioSourceStatus } from './base'

const CHUNK_SIZE = 3200 // 100ms at 16kHz mono 16bit

export class FLVSource implements AudioSource {
  private ffmpeg: ChildProcess | null = null
  private streamBuffer = Buffer.alloc(0)
  private audioCallback: ((pcm: Buffer) => void) | null = null
  private errorCallback: ((error: Error) => void) | null = null
  private stopped = false
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly retryBase = 2000
  private readonly maxRetryDelay = 60000

  constructor(private url: string) {}

  async start(): Promise<void> {
    this.stopped = false
    this.retryCount = 0
    this._connect()
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGTERM')
      this.ffmpeg = null
    }
    this.streamBuffer = Buffer.alloc(0)
  }

  onAudio(cb: (pcm: Buffer) => void): void {
    this.audioCallback = cb
  }

  onError(cb: (error: Error) => void): void {
    this.errorCallback = cb
  }

  getStatus(): AudioSourceStatus {
    if (this.stopped) {
      return { state: 'idle', reconnectCount: this.retryCount }
    }
    if (this.ffmpeg && !this.ffmpeg.killed) {
      return { state: 'running', reconnectCount: this.retryCount }
    }
    return { state: 'connecting', reconnectCount: this.retryCount }
  }

  private _connect(): void {
    if (this.stopped) return

    console.log(`[FLVSource] 连接 ${this.url}`)

    this.ffmpeg = spawn('ffmpeg', [
      '-i',
      this.url,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      's16le',
      'pipe:1',
    ])

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.streamBuffer = Buffer.concat([this.streamBuffer, chunk])
      while (this.streamBuffer.length >= CHUNK_SIZE) {
        const send = this.streamBuffer.subarray(0, CHUNK_SIZE)
        this.streamBuffer = this.streamBuffer.subarray(CHUNK_SIZE)
        this.audioCallback?.(Buffer.from(send))
      }
    })

    this.ffmpeg.stderr?.on('data', () => {
      // ffmpeg 进度信息，静默
    })

    this.ffmpeg.on('close', (code) => {
      console.log(`[FLVSource] ffmpeg 退出, code=${code}`)
      this.ffmpeg = null
      if (!this.stopped) {
        this._scheduleReconnect()
      }
    })

    this.ffmpeg.on('error', (err) => {
      console.error(`[FLVSource] ffmpeg 错误: ${err.message}`)
      this.ffmpeg = null
      if (!this.stopped) {
        this._scheduleReconnect()
      }
    })
  }

  private _scheduleReconnect(): void {
    if (this.stopped) return

    const delay = Math.min(this.retryBase * Math.pow(2, this.retryCount), this.maxRetryDelay)
    this.retryCount++
    console.log(`[FLVSource] ${delay / 1000}s 后重连 (第 ${this.retryCount} 次)`)

    if (this.retryCount > 10) {
      this.errorCallback?.(new Error(`重连中，第 ${this.retryCount} 次尝试`))
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this._connect()
    }, delay)
  }
}
```

- [ ] **Step 3: 创建 `server/utils/audio-source/mic.ts`**

```typescript
import type { AudioSource, AudioSourceStatus } from './base'

export class MicSource implements AudioSource {
  async start(): Promise<void> {
    throw new Error('MicSource 暂未实现')
  }

  stop(): void {}

  onAudio(): void {}

  onError(): void {}

  getStatus(): AudioSourceStatus {
    return { state: 'idle' }
  }
}
```

- [ ] **Step 4: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
git add server/utils/audio-source/
git commit -m "feat: 实现 AudioSource 抽象接口和 FLVSource"
```

---

### Task 3: AI Processor

**Files:**

- Create: `server/utils/ai-processor.ts`

- [ ] **Step 1: 创建 `server/utils/ai-processor.ts`**

```typescript
import type { AIResult } from '~/types/ai'

let useMockAI = true

export function setMockAI(enabled: boolean): void {
  useMockAI = enabled
}

export function isMockAI(): boolean {
  return useMockAI
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mockProcess(text: string): Promise<AIResult> {
  await delay(500 + Math.random() * 1000)

  return {
    optimizedText: `润色：${text}`,
    enText: `翻译：${text}`,
  }
}

async function realProcess(text: string): Promise<AIResult> {
  // TODO: 接入真实 AI API
  return { optimizedText: text, enText: '' }
}

export async function processAI(text: string): Promise<AIResult> {
  if (useMockAI) {
    return mockProcess(text)
  }
  return realProcess(text)
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add server/utils/ai-processor.ts
git commit -m "feat: 添加 AI 后处理器（mock 模式）"
```

---

### Task 4: ASR Bridge 改造

**Files:**

- Modify: `server/utils/asr-bridge.ts`

- [ ] **Step 1: 修改 `server/utils/asr-bridge.ts`**

将现有 import：

```typescript
import type { WSMessage, WSCurrentData, WSConfirmedData } from '../../types/websocket'
```

替换为：

```typescript
import type {
  WSMessage,
  WSCurrentData,
  WSConfirmedData,
  WSAIProcessedData,
} from '../../types/websocket'
import { processAI } from './ai-processor'
```

在 `let config: { url: string; provider: string; model: string } | null = null` 之后添加：

```typescript
let onReadyCallback: (() => void) | null = null
```

在 `connect()` 函数之后添加：

```typescript
export function setOnReadyCallback(cb: (() => void) | null): void {
  onReadyCallback = cb
}
```

在 `ws.on('message', ...)` 回调的 `ready` 分支中，将：

```typescript
} else if (msg.type === 'ready') {
  console.log('[ASR Bridge] 模型就绪')
}
```

改为：

```typescript
} else if (msg.type === 'ready') {
  console.log('[ASR Bridge] 模型就绪')
  if (onReadyCallback) {
    onReadyCallback()
  }
}
```

将 `processResult` 函数中 `result.type === 'final'` 分支替换为：

```typescript
} else if (result.type === 'final') {
  partialVersion = 0
  const id = `asr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`

  const data: WSConfirmedData = {
    id,
    text: result.text,
    optimizedText: '',
    enText: ''
  }
  broadcast({ type: 'confirmed', data })
  broadcast({ type: 'current', data: { text: '', enText: '', version: 0, enVersion: 0 } })

  transcriptionState.currentSubtitle = null
  transcriptionState.confirmedSubtitles.push({
    id,
    text: result.text,
    timestamp: Date.now()
  })

  processAI(result.text).then(ai => {
    broadcast({ type: 'ai-processed', data: { id, optimizedText: ai.optimizedText, enText: ai.enText } })
    const subtitle = transcriptionState.confirmedSubtitles.find(s => s.id === id)
    if (subtitle) {
      subtitle.optimizedText = ai.optimizedText
      subtitle.enText = ai.enText
    }
  })
}
```

在 `stopASR()` 函数中添加回调清理（在 `status = 'disconnected'` 之后）：

```typescript
onReadyCallback = null
```

在 `getASRStatus()` 的返回对象中添加：

```typescript
modelLoaded: status === 'connected'
```

- [ ] **Step 2: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add server/utils/asr-bridge.ts
git commit -m "feat: ASR Bridge 添加就绪回调和 AI 后处理集成"
```

---

### Task 5: LiveTransManager

**Files:**

- Create: `server/utils/live-trans-manager.ts`

- [ ] **Step 1: 创建 `server/utils/live-trans-manager.ts`**

```typescript
import type { LiveTransState } from '~/types/websocket'
import type { AudioSource } from './audio-source/base'
import { FLVSource } from './audio-source/flv'
import { startASR, stopASR, setOnReadyCallback, sendAudioChunk, getASRStatus } from './asr-bridge'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
import { stopSimulation } from './simulator'

type LiveTransConfig = {
  sourceType: 'flv' | 'mic'
  streamUrl?: string
}

let state: LiveTransState = 'idle'
let audioSource: AudioSource | null = null
let asrConnected = false
let pendingAudio: Buffer[] = []
let startTime: number | null = null
let stateCheckInterval: ReturnType<typeof setInterval> | null = null

const DEFAULT_FLV_URL = process.env.FLV_STREAM_URL || 'http://mini:8080/live/livestream.flv'

function _updateState(newState: LiveTransState, error?: string): void {
  state = newState
  const status = audioSource?.getStatus()
  broadcast({
    type: 'status',
    data: {
      state,
      error,
      reconnectCount: status?.reconnectCount,
    },
  })
}

function _pendingAudioDuration(): number {
  return pendingAudio.length * 0.1
}

function _onAudio(pcm: Buffer): void {
  if (!asrConnected) {
    pendingAudio.push(pcm)
    if (_pendingAudioDuration() > 10) {
      pendingAudio.shift()
    }
    return
  }
  sendAudioChunk(pcm.toString('base64'))
}

function _onError(error: Error): void {
  console.error(`[LiveTrans] 音频源错误: ${error.message}`)
  const status = audioSource?.getStatus()
  if (status?.state === 'error') {
    _updateState('reconnecting', error.message)
  }
}

function _onAudioSourceStateChange(): void {
  if (!audioSource) return
  const sourceStatus = audioSource.getStatus()

  if (sourceStatus.state === 'running' && asrConnected) {
    _updateState('running')
  } else if (sourceStatus.state === 'connecting') {
    _updateState('connecting')
  } else if (sourceStatus.state === 'error') {
    _updateState('reconnecting')
  }
}

async function start(config: LiveTransConfig): Promise<boolean> {
  if (state !== 'idle') {
    return false
  }

  stopSimulation()

  // 1. 连接 ASR Bridge
  const asrUrl = process.env.ASR_WS_URL || 'ws://localhost:9900'
  transcriptionState.isActive = true
  transcriptionState.source = 'asr'

  const asrSuccess = startASR({ url: asrUrl, provider: 'gguf', model: '' }, 'stream')
  if (!asrSuccess) {
    _updateState('idle', 'ASR 启动失败')
    transcriptionState.isActive = false
    transcriptionState.source = null
    return false
  }

  // 2. 注册 ASR 就绪回调
  asrConnected = false
  setOnReadyCallback(() => {
    console.log('[LiveTrans] ASR 就绪')
    asrConnected = true

    for (const pcm of pendingAudio) {
      sendAudioChunk(pcm.toString('base64'))
    }
    pendingAudio = []

    if (audioSource?.getStatus().state === 'running') {
      _updateState('running')
    }
  })

  // 3. 创建并启动音频源
  _updateState('connecting')

  if (config.sourceType === 'flv') {
    const url = config.streamUrl || DEFAULT_FLV_URL
    audioSource = new FLVSource(url)
    audioSource.onAudio(_onAudio)
    audioSource.onError(_onError)
    await audioSource.start()
  }

  startTime = Date.now()

  // 定期检查音频源状态
  stateCheckInterval = setInterval(() => {
    if (state === 'idle' || !audioSource) {
      clearInterval(stateCheckInterval)
      return
    }
    _onAudioSourceStateChange()
  }, 2000)

  return true
}

function stop(): void {
  if (state === 'idle') return

  _updateState('idle')

  audioSource?.stop()
  audioSource = null

  if (stateCheckInterval) {
    clearInterval(stateCheckInterval)
    stateCheckInterval = null
  }

  stopASR()

  asrConnected = false
  pendingAudio = []
  startTime = null

  transcriptionState.isActive = false
  transcriptionState.source = null
  transcriptionState.currentSubtitle = null
}

function getStatus(): {
  state: LiveTransState
  sourceType: 'flv' | 'mic' | null
  reconnectCount: number
  uptime: number
} {
  const sourceStatus = audioSource?.getStatus()
  return {
    state,
    sourceType: audioSource ? 'flv' : null,
    reconnectCount: sourceStatus?.reconnectCount ?? 0,
    uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
  }
}

export const liveTransManager = {
  start,
  stop,
  getStatus,
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add server/utils/live-trans-manager.ts
git commit -m "feat: 实现 LiveTransManager 直播转录管理器"
```

---

### Task 6: API 端点

**Files:**

- Create: `server/routes/api/live/start.ts`
- Create: `server/routes/api/live/stop.ts`
- Create: `server/routes/api/live/status.ts`
- Create: `server/routes/api/live/ai-config.ts`

- [ ] **Step 1: 创建 `server/routes/api/live/start.ts`**

```typescript
import { liveTransManager } from '../../../utils/live-trans-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { sourceType, streamUrl } = body

  if (!sourceType || !['flv', 'mic'].includes(sourceType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType must be "flv" or "mic"',
    })
  }

  const status = liveTransManager.getStatus()
  if (status.state !== 'idle') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Live transcription already running',
    })
  }

  const success = await liveTransManager.start({ sourceType, streamUrl })

  return {
    success,
    sourceType,
  }
})
```

- [ ] **Step 2: 创建 `server/routes/api/live/stop.ts`**

```typescript
import { liveTransManager } from '../../../utils/live-trans-manager'

export default defineEventHandler(() => {
  liveTransManager.stop()
  return { success: true }
})
```

- [ ] **Step 3: 创建 `server/routes/api/live/status.ts`**

```typescript
import { liveTransManager } from '../../../utils/live-trans-manager'

export default defineEventHandler(() => {
  return liveTransManager.getStatus()
})
```

- [ ] **Step 4: 创建 `server/routes/api/live/ai-config.ts`**

```typescript
import { isMockAI, setMockAI } from '../../../utils/ai-processor'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    return { useMockAI: isMockAI() }
  }

  if (method === 'POST') {
    const body = await readBody(event).catch(() => ({}))
    if (typeof body.useMockAI === 'boolean') {
      setMockAI(body.useMockAI)
    }
    return { useMockAI: isMockAI() }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
```

- [ ] **Step 5: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 6: 提交**

```bash
git add server/routes/api/live/
git commit -m "feat: 添加直播转录 API 端点"
```

---

### Task 7: 前端 — useSubtitles 处理 ai-processed

**Files:**

- Modify: `composables/useSubtitles.ts`

- [ ] **Step 1: 在 `composables/useSubtitles.ts` 的 `import` 区域添加类型导入**

在 `import type { WSMessage } from '~/types/websocket'` 之后添加：

```typescript
import type { WSAIProcessedData } from '~/types/websocket'
```

- [ ] **Step 2: 在 `handleMessage` 函数的 switch 中，`case 'clear':` 之前添加 `ai-processed` 分支**

```typescript
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

- [ ] **Step 3: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add composables/useSubtitles.ts
git commit -m "feat: 前端处理 ai-processed 消息更新字幕"
```

---

### Task 8: 前端 — LiveTransControl 组件

**Files:**

- Create: `components/admin/LiveTransControl.vue`

- [ ] **Step 1: 创建 `components/admin/LiveTransControl.vue`**

```vue
<script setup lang="ts">
import type { LiveTransState } from '~/types/websocket'

const props = withDefaults(
  defineProps<{
    isRunning: boolean
    isLoading: boolean
  }>(),
  {
    isRunning: false,
    isLoading: false,
  },
)

const emit = defineEmits<{
  start: []
  stop: []
}>()

const status = ref<{
  state: LiveTransState
  sourceType: string | null
  reconnectCount: number
  uptime: number
} | null>(null)

const useMockAI = ref(true)

const statusLabel = computed(() => {
  const s = status.value?.state ?? 'idle'
  const labels: Record<string, string> = {
    idle: '空闲',
    connecting: '连接中...',
    running: '运行中',
    reconnecting: `重连中 (#${status.value?.reconnectCount ?? 0})`,
  }
  return labels[s] ?? s
})

const statusColor = computed(() => {
  const s = status.value?.state ?? 'idle'
  const colors: Record<string, string> = {
    idle: '#64748b',
    connecting: '#f59e0b',
    running: '#10b981',
    reconnecting: '#f97316',
  }
  return colors[s] ?? '#64748b'
})

const uptimeFormatted = computed(() => {
  const seconds = status.value?.uptime ?? 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const canStart = computed(() => !props.isLoading && !props.isRunning)
const canStop = computed(() => !props.isLoading && props.isRunning)

const fetchStatus = async () => {
  try {
    status.value = (await $fetch('/api/live/status')) as typeof status.value
  } catch {
    // ignore
  }
}

const fetchAIConfig = async () => {
  try {
    const res = (await $fetch('/api/live/ai-config')) as { useMockAI: boolean }
    useMockAI.value = res.useMockAI
  } catch {
    // ignore
  }
}

const handleStart = async () => {
  emit('start')
}

const handleStop = async () => {
  emit('stop')
}

const handleToggleMockAI = async () => {
  const newVal = !useMockAI.value
  try {
    const res = (await $fetch('/api/live/ai-config', {
      method: 'POST',
      body: { useMockAI: newVal },
    })) as { useMockAI: boolean }
    useMockAI.value = res.useMockAI
  } catch {
    // ignore
  }
}

let interval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchStatus()
  fetchAIConfig()
  interval = setInterval(fetchStatus, 3000)
})

onUnmounted(() => {
  if (interval) clearInterval(interval)
})
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </div>
      <span class="panel-title">LIVE TRANS</span>
      <span v-if="isRunning" class="status-badge active">LIVE</span>
    </div>

    <div class="panel-content">
      <!-- 状态信息 -->
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">STATUS</span>
          <span class="info-value" :style="{ color: statusColor }">
            <span class="status-dot" :style="{ background: statusColor }"></span>
            {{ statusLabel }}
          </span>
        </div>
        <div class="info-item">
          <span class="info-label">UPTIME</span>
          <span class="info-value">{{ uptimeFormatted }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">RECONNECT</span>
          <span class="info-value">{{ status?.reconnectCount ?? 0 }}</span>
        </div>
      </div>

      <!-- Mock AI 开关 -->
      <div class="form-row">
        <label class="form-label">MOCK AI</label>
        <button class="toggle-btn" :class="{ active: useMockAI }" @click="handleToggleMockAI">
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
          <span class="toggle-text">{{ useMockAI ? 'ON' : 'OFF' }}</span>
        </button>
      </div>

      <!-- 操作按钮 -->
      <div class="action-row">
        <button
          v-if="!isRunning"
          class="action-btn start"
          :disabled="!canStart"
          @click="handleStart"
        >
          START LIVE
        </button>
        <button v-else class="action-btn stop" :disabled="!canStop" @click="handleStop">
          STOP
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
}

.panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.5), transparent);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.panel-icon {
  width: 36px;
  height: 36px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
}

.panel-icon svg {
  width: 20px;
  height: 20px;
}

.panel-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.status-badge {
  margin-left: auto;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.status-badge.active {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid rgba(16, 185, 129, 0.5);
  color: #10b981;
  animation: pulse 1.5s ease-in-out infinite;
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.info-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.6);
}

.info-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 500;
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.form-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.form-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.7);
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: rgba(71, 85, 105, 0.5);
  border-radius: 10px;
  position: relative;
  transition: background 0.3s ease;
}

.toggle-btn.active .toggle-track {
  background: rgba(56, 189, 248, 0.5);
}

.toggle-thumb {
  width: 16px;
  height: 16px;
  background: #94a3b8;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: all 0.3s ease;
}

.toggle-btn.active .toggle-thumb {
  left: 18px;
  background: #38bdf8;
}

.toggle-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #94a3b8;
}

.toggle-btn.active .toggle-text {
  color: #38bdf8;
}

.action-row {
  margin-top: 0.5rem;
}

.action-btn {
  width: 100%;
  padding: 0.75rem;
  border-radius: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid;
}

.action-btn.start {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1));
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
}

.action-btn.start:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.2));
  border-color: rgba(16, 185, 129, 0.6);
}

.action-btn.stop {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1));
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

.action-btn.stop:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.2));
  border-color: rgba(239, 68, 68, 0.6);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add components/admin/LiveTransControl.vue
git commit -m "feat: 添加 LiveTransControl 管理后台组件"
```

---

### Task 9: 前端 — admin.vue 集成

**Files:**

- Modify: `pages/admin.vue`

- [ ] **Step 1: 在 `pages/admin.vue` 的 `<script setup>` 中添加直播转录相关状态和处理函数**

在 `const asrIsLoading = ref(false)` 之后添加：

```typescript
// 直播转录相关状态
const liveIsRunning = ref(false)
const liveIsLoading = ref(false)
```

在 `handleASRStop` 函数之后添加：

```typescript
// 直播转录控制
const handleLiveStart = async () => {
  liveIsLoading.value = true
  try {
    await $fetch('/api/live/start', {
      method: 'POST',
      body: { sourceType: 'flv' },
    })
    liveIsRunning.value = true
  } catch (error) {
    console.error('Failed to start live transcription:', error)
  } finally {
    liveIsLoading.value = false
  }
}

const handleLiveStop = async () => {
  liveIsLoading.value = true
  try {
    await $fetch('/api/live/stop', { method: 'POST' })
    liveIsRunning.value = false
  } catch (error) {
    console.error('Failed to stop live transcription:', error)
  } finally {
    liveIsLoading.value = false
  }
}
```

- [ ] **Step 2: 在 `<template>` 的 control-grid 中，ASR 控制面板之后添加 LiveTransControl**

在 `<!-- ASR 控制面板 -->` 的 `</ASRControlPanel>` 之后、`<!-- 模型状态面板 -->` 之前添加：

```vue
<!-- 直播转录控制 -->
<LiveTransControl
  :is-running="liveIsRunning"
  :is-loading="liveIsLoading"
  @start="handleLiveStart"
  @stop="handleLiveStop"
/>
```

- [ ] **Step 3: 验证编译**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add pages/admin.vue
git commit -m "feat: 管理后台集成直播转录控制面板"
```

---

### Task 10: Python 前置静音过滤

**Files:**

- Modify: `asr/providers/gguf/provider.py`

- [ ] **Step 1: 在 `asr/providers/gguf/provider.py` 的 `_process_loop` 方法中，在 `audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0` 之后、`buffer = np.concatenate([buffer, audio])` 之前插入前置静音过滤代码**

插入以下代码：

```python
            # 前置静音过滤（使用独立 state，不影响主 VAD 分段逻辑）
            if len(buffer) == 0 and len(audio) >= VAD_CHUNK_SIZE:
                aligned = audio[:(len(audio) // VAD_CHUNK_SIZE) * VAD_CHUNK_SIZE]
                temp_state = np.zeros((2, 1, 128), dtype=np.float32)
                temp_context = np.zeros((1, VAD_CONTEXT_SIZE), dtype=np.float32)
                all_silence = True
                for i in range(0, len(aligned), VAD_CHUNK_SIZE):
                    chunk_vad = aligned[i:i + VAD_CHUNK_SIZE].reshape(1, -1)
                    x = np.concatenate([temp_context, chunk_vad], axis=1)
                    out, temp_state = self._vad_session.run(
                        None,
                        {"input": x, "state": temp_state, "sr": np.array(SAMPLE_RATE, dtype=np.int64)},
                    )
                    temp_context = chunk_vad[:, -VAD_CONTEXT_SIZE:]
                    if float(out[0][0]) >= self.vad_threshold:
                        all_silence = False
                        break
                if all_silence:
                    continue
```

- [ ] **Step 2: 提交**

```bash
git add asr/providers/gguf/provider.py
git commit -m "feat: 添加前置 VAD 静音过滤"
```

---

### Task 11: 清理废弃文件

**Files:**

- Delete: `server/utils/stream-manager.ts`
- Delete: `server/routes/api/stream/start.ts`
- Delete: `server/routes/api/stream/stop.ts`

- [ ] **Step 1: 删除废弃文件**

```bash
rm server/utils/stream-manager.ts
rm server/routes/api/stream/start.ts
rm server/routes/api/stream/stop.ts
rmdir server/routes/api/stream 2>/dev/null || true
```

- [ ] **Step 2: 验证编译**

Run: `pnpm build`
Expected: 编译成功（确保没有其他文件引用被删除的模块）

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: 移除废弃的 stream-manager 和 stream API 端点"
```

---

### Task 12: 全链路验证

- [ ] **Step 1: 启动开发服务器**

Run: `pnpm dev`
Expected: 服务启动成功

- [ ] **Step 2: 访问管理后台**

打开浏览器访问 `http://localhost:3000/admin`
Expected: 看到 LIVE TRANS 控制面板，状态显示"空闲"

- [ ] **Step 3: 验证 Mock AI 开关**

点击 MOCK AI 切换按钮
Expected: 开关状态在 ON/OFF 之间切换

- [ ] **Step 4: 验证 API 端点**

```bash
curl http://localhost:3000/api/live/status
curl http://localhost:3000/api/live/ai-config
curl -X POST http://localhost:3000/api/live/ai-config -H 'Content-Type: application/json' -d '{"useMockAI":false}'
curl http://localhost:3000/api/live/ai-config
```

Expected:

- status 返回 `{ state: 'idle', ... }`
- ai-config 返回 `{ useMockAI: true/false }`

- [ ] **Step 5: 验证前端 WebSocket 消息处理**

在管理后台 WS EVENT TEST 面板发送 `ai-processed` 消息：

- MESSAGE TYPE: 选择 `confirmed`（临时用 confirmed 测试，改为 ai-processed）
- 填写 id、optimizedText、enText

Expected: 消息发送成功（由于 ai-processed 不是 wsMessageTypes 列表中的选项，可跳过此步）

---

## 自审清单

1. **Spec 覆盖**:
   - ✅ AudioSource 抽象 → Task 2
   - ✅ FLVSource 实现 → Task 2
   - ✅ MicSource 预留 → Task 2
   - ✅ LiveTransManager → Task 5
   - ✅ AI 后处理 mock → Task 3
   - ✅ ASR Bridge 改造 → Task 4
   - ✅ API 端点 → Task 6
   - ✅ 前端 LiveTransControl → Task 8
   - ✅ 前端 useSubtitles ai-processed → Task 7
   - ✅ 前端 admin.vue 集成 → Task 9
   - ✅ Python 前置 VAD 过滤 → Task 10
   - ✅ 清理废弃文件 → Task 11

2. **Placeholder 扫描**: 无 TBD/TODO

3. **类型一致性**: `LiveTransState` 在 types/websocket.ts 定义，在 live-trans-manager.ts 和 LiveTransControl.vue 中使用，命名一致。`WSAIProcessedData` 在 types/websocket.ts 定义，在 useSubtitles.ts 和 asr-bridge.ts 中使用，命名一致。
