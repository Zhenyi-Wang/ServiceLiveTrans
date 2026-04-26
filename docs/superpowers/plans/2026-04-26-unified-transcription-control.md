# 统一转录控制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将分散的 ASR 服务控制和音频源控制合并为一键式转录控制，链式启动/停止，WebSocket 推送替代所有轮询。

**Architecture:** 新增 `transcription-orchestrator.ts` 作为唯一对外入口，编排链式启动/停止/重试/恢复。重构 `transcription-manager.ts` 暴露公开方法供 Orchestrator 调用。前端合并两个面板为 `TranscriptionControlPanel`，新增 `useTranscription` composable 管理 WS 推送状态。

**Tech Stack:** Nuxt 4, TypeScript, Nitro WebSocket, Vue 3 Composition API

---

### Task 1: 类型定义更新

**Files:**
- Modify: `types/websocket.ts`

- [ ] **Step 1: 更新类型定义**

将 `types/websocket.ts` 替换为以下内容：

```typescript
/**
 * 转录状态
 * @deprecated 使用 TranscriptionStatusData.state 替代
 */
export type TranscriptionStateType = 'idle' | 'starting' | 'running' | 'error' | 'reconnecting'

/**
 * WebSocket 消息类型
 */
export type WSMessageType =
  | 'init'
  | 'confirmed'
  | 'current'
  | 'clear'
  | 'status'  // @deprecated 由 'transcription-status' 替代，Task 10 删除
  | 'ai-processed'
  | 'transcription-status'
  | 'transcription-progress'
  | 'connection-count'
  | 'audio-source-start'
  | 'audio-source-stop'

/**
 * 初始化消息数据
 */
export interface WSInitData {
  current: string | null
  confirmed: ConfirmedSubtitle[]
  transcriptionStatus?: TranscriptionStatusData
  connectionCount?: number
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
 * 转录状态变化通知
 * @deprecated 使用 TranscriptionStatusData 替代
 */
export interface WSStatusData {
  state: TranscriptionStateType
  source?: string | null
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
 * 转录状态数据（新统一格式）
 */
export interface TranscriptionStatusData {
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  audio: { active: boolean; label: string; detail?: string }
  recognition: { active: boolean; detail?: string }
  error?: string
  uptime: number
}

/**
 * 转录进度数据
 */
export interface TranscriptionProgressData {
  step: 'health-checking' | 'health-ok' | 'service-starting' | 'service-ready' | 'bridge-connecting' | 'bridge-connected' | 'model-loading' | 'model-ready' | 'source-starting' | 'source-ready' | 'stopping-source' | 'stopping-bridge' | 'stopping-service'
}

/**
 * 连接数数据
 */
export interface ConnectionCountData {
  count: number
}

/**
 * 音频源启动指令数据
 */
export interface AudioSourceCommandData {
  source: 'mic' | 'file' | 'stream'
}

/**
 * 音频源停止指令数据
 */
export interface AudioSourceStopData {}

/**
 * WebSocket 消息
 */
export interface WSMessage {
  type: WSMessageType
  data?:
    | WSInitData
    | WSConfirmedData
    | WSCurrentData
    | WSStatusData
    | WSAIProcessedData
    | TranscriptionStatusData
    | TranscriptionProgressData
    | ConnectionCountData
    | AudioSourceCommandData
    | AudioSourceStopData
    | null
}
```

- [ ] **Step 2: 提交**

```bash
git add types/websocket.ts
git commit -m "feat: 更新 WebSocket 类型定义，新增转录状态/进度/连接数消息类型"
```

---

### Task 2: websocket.ts 增加 connection-count 广播

**Files:**
- Modify: `server/utils/websocket.ts`

- [ ] **Step 1: 在 addConnection/removeConnection 中触发广播**

在 `server/utils/websocket.ts` 中，`addConnection` 和 `removeConnection` 函数末尾添加 `connection-count` 广播：

```typescript
import type { WSMessage } from '../../types/websocket'

const activeConnections = new Set<any>()

export function addConnection(peer: any) {
  activeConnections.add(peer)
  broadcastConnectionCount()
}

export function removeConnection(peer: any) {
  activeConnections.delete(peer)
  broadcastConnectionCount()
}

function broadcastConnectionCount() {
  broadcast({
    type: 'connection-count',
    data: { count: activeConnections.size }
  })
}

export function getConnectionCount(): number {
  return activeConnections.size
}

export function broadcast(message: WSMessage) {
  const messageStr = JSON.stringify(message)
  for (const peer of activeConnections) {
    try {
      peer.send(messageStr)
    } catch (error) {
      console.error('Failed to send message to peer:', error)
    }
  }
}

export function sendTo(peer: any, message: WSMessage) {
  try {
    peer.send(JSON.stringify(message))
  } catch (error) {
    console.error('Failed to send message to peer:', error)
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add server/utils/websocket.ts
git commit -m "feat: 连接数变化时自动广播 connection-count 消息"
```

---

### Task 3: transcription-manager 重构 + 删除旧 API 端点

**Files:**
- Modify: `server/utils/transcription-manager.ts`
- Delete: `server/routes/api/asr/start.ts`
- Delete: `server/routes/api/asr/stop.ts`
- Delete: `server/routes/api/asr/status.ts` — 引用已移除的 `transcriptionManager.getStatus()`，改为 WS 推送

> **注意：** 必须同时删除旧 API 端点，否则它们引用的 `transcriptionManager.start()` 和 `transcriptionManager.stop()` 已不存在，会导致运行时崩溃。

- [ ] **Step 1: 删除旧 API 端点**

```bash
rm server/routes/api/asr/start.ts
rm server/routes/api/asr/stop.ts
rm server/routes/api/asr/status.ts
```

- [ ] **Step 2: 重构 transcription-manager，暴露公开方法供 Orchestrator 调用**

将 `transcription-manager.ts` 中的私有函数改为通过公开方法暴露。移除 `start()` 和 `stop()` 方法（这些由 Orchestrator 接管），保留 ASR 结果处理和音频转发逻辑。将 `_broadcastStatus()` 替换为发送 `transcription-status` 消息。

关键变更：
1. 移除 `start()` 和 `stop()` 公开方法
2. 新增 `connectBridge(config)`, `disconnectBridge()`, `onReady(callback)`, `stopStreamSource()`, `sendAudioChunk(data)`, `isBridgeConnected()`, `getBridgeStatus()`, `setManagerState(state)`
3. 将 `bridgeConnect()` 改为接受 config 参数的 `connectBridge()`
4. 将 `_broadcastStatus()` 替换为 `broadcastStatus()` 发送 `transcription-status` 类型
5. 移除 `FLVSource` 创建逻辑（由 Orchestrator 负责），但保留 `streamAudioSource` 的存储和 `stopStreamSource()`

```typescript
import { WebSocket } from 'ws'
import type { WSMessage, WSCurrentData, WSConfirmedData, TranscriptionStatusData } from '../../types/websocket'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
import { stopSimulation } from './simulator'
import { processAI } from './ai-processor'
import type { AudioSource } from './audio-source/base'

export type SourceType = 'mic' | 'file' | 'stream'

interface BridgeConfig {
  url: string
  provider: string
  model: string
  overlap_sec?: number
  memory_chunks?: number
}

// ASR Bridge 内部状态
let ws: WebSocket | null = null
let bridgeStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let bridgeConfig: BridgeConfig | null = null
let readyCallback: (() => void) | null = null
let bridgeDisconnectCallback: (() => void) | null = null
let partialVersion = 0

// 音频源（仅 stream 源由后端管理）
let audioSource: AudioSource | null = null
let asrReady = false
let pendingAudio: Buffer[] = []
let startTime: number | null = null

// 由 Orchestrator 管理的公共状态
let managerState: 'idle' | 'starting' | 'running' | 'stopping' | 'error' = 'idle'
let currentSource: SourceType | null = null

// === ASR Bridge ===

function scheduleBridgeReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    bridgeConnect()
  }, 3000)
}

function sendAudioChunkToASR(base64Pcm: string): boolean {
  if (!ws || bridgeStatus !== 'connected') return false
  try {
    ws.send(JSON.stringify({ type: 'audio', data: base64Pcm }))
    return true
  } catch {
    return false
  }
}

// === ASR 结果处理 ===

function processResult(result: { type: string; text: string; language: string }): void {
  if (result.type === 'partial') {
    partialVersion++
    const data: WSCurrentData = {
      text: result.text,
      enText: '',
      version: partialVersion,
      enVersion: 0
    }
    broadcast({ type: 'current', data })
    transcriptionState.currentSubtitle = {
      text: result.text,
      enText: '',
      version: partialVersion,
      enVersion: 0,
      startTime: Date.now()
    }
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
}

// === 音频源回调（仅 stream 源） ===

function _onAudio(pcm: Buffer): void {
  if (!asrReady) {
    pendingAudio.push(pcm)
    if (pendingAudio.length * 0.1 > 10) {
      pendingAudio.shift()
    }
    return
  }
  sendAudioChunkToASR(pcm.toString('base64'))
}

function _onError(error: Error): void {
  console.error(`[TranscriptionManager] 音频源错误: ${error.message}`)
  managerState = 'error'
  broadcastStatus()
}

// === 状态广播 ===

export function broadcastStatus(): void {
  const sourceLabel = currentSource === 'mic' ? '麦克风' : currentSource === 'file' ? '文件' : currentSource === 'stream' ? '直播流' : ''
  const sourceStatus = audioSource?.getStatus()
  const audioDetail = sourceStatus
    ? (sourceStatus.state === 'running' ? '运行中' : sourceStatus.state === 'connecting' ? '连接中' : sourceStatus.state === 'error' ? '错误' : undefined)
    : (managerState === 'running' && currentSource ? '运行中' : undefined)

  const data: TranscriptionStatusData = {
    state: managerState,
    audio: {
      active: currentSource !== null,
      label: sourceLabel,
      detail: audioDetail
    },
    recognition: {
      active: bridgeStatus === 'connected' && asrReady,
      detail: bridgeStatus === 'connected' ? (asrReady ? '运行中' : '加载中') : '已停止'
    },
    uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
  }
  broadcast({ type: 'transcription-status', data })
}

// === 公开 API（供 Orchestrator 调用） ===

export const transcriptionManager = {
  connectBridge(config: BridgeConfig): void {
    if (bridgeStatus === 'connected') return
    bridgeConfig = config
    bridgeStatus = 'connecting'

    try {
      ws = new WebSocket(bridgeConfig.url)

      ws.on('open', () => {
        bridgeStatus = 'connected'
        console.log(`[TranscriptionManager] ASR 已连接: ${bridgeConfig!.url}`)
        ws!.send(JSON.stringify({
          type: 'config',
          provider: bridgeConfig!.provider,
          model: bridgeConfig!.model,
          ...(bridgeConfig!.overlap_sec !== undefined ? { overlap_sec: bridgeConfig!.overlap_sec } : {}),
          ...(bridgeConfig!.memory_chunks !== undefined ? { memory_chunks: bridgeConfig!.memory_chunks } : {}),
        }))
      })

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'partial' || msg.type === 'final') {
            processResult(msg)
          } else if (msg.type === 'error') {
            console.error(`[TranscriptionManager] Python 错误: ${msg.message}`)
          } else if (msg.type === 'loading') {
            console.log('[TranscriptionManager] 模型加载中...')
          } else if (msg.type === 'ready') {
            console.log('[TranscriptionManager] 模型就绪')
            asrReady = true
            readyCallback?.()
          } else if (msg.type === 'unloaded') {
            console.log('[TranscriptionManager] 模型已卸载')
          }
        } catch (e) {
          console.error('[TranscriptionManager] 消息解析失败:', e)
        }
      })

      ws.on('close', () => {
        bridgeStatus = 'disconnected'
        asrReady = false
        console.log('[TranscriptionManager] ASR 连接断开')
        bridgeDisconnectCallback?.()
      })

      ws.on('error', (err: Error) => {
        bridgeStatus = 'disconnected'
        asrReady = false
        console.error('[TranscriptionManager] ASR 连接错误:', err.message)
      })
    } catch (e) {
      bridgeStatus = 'disconnected'
      console.error('[TranscriptionManager] 创建连接失败:', e)
      scheduleBridgeReconnect()
    }
  },

  disconnectBridge(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    bridgeStatus = 'disconnected'
    asrReady = false
  },

  onReady(callback: () => void): void {
    readyCallback = callback
  },

  clearReadyCallback(): void {
    readyCallback = null
  },

  onBridgeDisconnect(callback: () => void): void {
    bridgeDisconnectCallback = callback
  },

  sendAudioChunk(base64Pcm: string): boolean {
    if (!asrReady) {
      pendingAudio.push(Buffer.from(base64Pcm, 'base64'))
      if (pendingAudio.length * 0.1 > 10) {
        pendingAudio.shift()
      }
      return false
    }
    return sendAudioChunkToASR(base64Pcm)
  },

  isBridgeConnected(): boolean {
    return bridgeStatus === 'connected'
  },

  isASRReady(): boolean {
    return asrReady
  },

  getBridgeStatus(): string {
    return bridgeStatus
  },

  setStreamSource(source: AudioSource): void {
    audioSource = source
    source.onAudio(_onAudio)
    source.onError(_onError)
  },

  stopStreamSource(): void {
    audioSource?.stop()
    audioSource = null
  },

  hasStreamSource(): boolean {
    return audioSource !== null
  },

  setManagerState(state: typeof managerState): void {
    managerState = state
    broadcastStatus()
  },

  setSource(source: SourceType | null): void {
    currentSource = source
  },

  getSource(): SourceType | null {
    return currentSource
  },

  getState(): typeof managerState {
    return managerState
  },

  setStartTime(): void {
    startTime = Date.now()
  },

  resetState(): void {
    pendingAudio = []
    partialVersion = 0
    readyCallback = null
    bridgeConfig = null
    startTime = null
    currentSource = null
    managerState = 'idle'
    transcriptionState.isActive = false
    transcriptionState.source = null
    transcriptionState.currentSubtitle = null
    transcriptionState.confirmedSubtitles = []
  },

  isActive(): boolean {
    return managerState !== 'idle'
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add server/utils/transcription-manager.ts
git commit -m "refactor: 重构 transcription-manager，暴露公开方法供编排器调用"
```

---

### Task 4: WS handler 增强 init 消息

**Files:**
- Modify: `server/routes/api/ws.ts`

- [ ] **Step 1: 增强 init 消息，包含转录状态和连接数**

```typescript
import type { WSMessage } from '../../../types/websocket'
import { addConnection, removeConnection, sendTo, getConnectionCount, broadcast } from '../../utils/websocket'
import { transcriptionState } from '../../utils/transcription-state'
import { transcriptionManager } from '../../utils/transcription-manager'

export default defineWebSocketHandler({
  open(peer) {
    addConnection(peer)
    console.log(`WebSocket connected: ${peer}`)

    const initMessage: WSMessage = {
      type: 'init',
      data: {
        current: transcriptionState.currentSubtitle?.text ?? null,
        confirmed: transcriptionState.confirmedSubtitles,
        transcriptionStatus: {
          state: transcriptionManager.getState(),
          audio: {
            active: transcriptionManager.isActive(),
            label: transcriptionManager.getSource() === 'mic' ? '麦克风' : transcriptionManager.getSource() === 'file' ? '文件' : transcriptionManager.getSource() === 'stream' ? '直播流' : '',
          },
          recognition: {
            active: transcriptionManager.isBridgeConnected() && transcriptionManager.isASRReady(),
          },
          uptime: 0
        },
        connectionCount: getConnectionCount()
      }
    }
    sendTo(peer, initMessage)
  },
  message(peer, message) {
    try {
      const data = JSON.parse(message as string)
      if (data.type === 'audio' && data.data) {
        transcriptionManager.sendAudioChunk(data.data)
      }
    } catch {
      // 忽略非 JSON 消息
    }
  },
  close(peer) {
    removeConnection(peer)
    console.log(`WebSocket disconnected: ${peer}`)
  },
  error(peer, error) {
    console.error(`WebSocket error: ${error}`)
    removeConnection(peer)
  }
})
```

- [ ] **Step 2: 提交**

```bash
git add server/routes/api/ws.ts
git commit -m "feat: 增强 WS init 消息，包含转录状态和连接数"
```

---

### Task 5: 新增 transcription-orchestrator

**Files:**
- Create: `server/utils/transcription-orchestrator.ts`

- [ ] **Step 1: 实现链式编排器**

```typescript
import { transcriptionManager, type SourceType } from './transcription-manager'
import { getASRServiceHealth, startASRProcess, stopASRProcess } from './asr-process'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
import { stopSimulation } from './simulator'
import type { TranscriptionProgressData } from '../../types/websocket'

const DEFAULT_FLV_URL = process.env.FLV_STREAM_URL || 'http://mini:8080/live/livestream.flv'
const ASR_WS_URL = process.env.ASR_WS_URL || 'ws://localhost:9900'

type OrchestratorState = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

interface StartConfig {
  source: SourceType
  streamUrl?: string
  provider?: string
  model?: string
  overlapSec?: number
  memoryChunks?: number
}

let state: OrchestratorState = 'idle'
let currentConfig: StartConfig | null = null
let completedSteps = new Set<string>()
let errorDetail: string | null = null

function broadcastProgress(step: TranscriptionProgressData['step']): void {
  broadcast({ type: 'transcription-progress', data: { step } })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  stepName: string,
  maxRetries = 3
): Promise<T> {
  const delays = [1000, 2000, 4000]
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      if (i === maxRetries) throw e
      console.log(`[Orchestrator] ${stepName} 失败，${delays[i] / 1000}s 后重试 (${i + 1}/${maxRetries}): ${e.message}`)
      await delay(delays[i])
    }
  }
  throw new Error('unreachable')
}

async function healthCheck(): Promise<boolean> {
  const health = await getASRServiceHealth()
  return health.status === 'ok'
}

async function launchService(): Promise<void> {
  broadcastProgress('service-starting')
  const result = await startASRProcess()
  if (!result) throw new Error('启动服务失败')
}

async function waitForServiceHealthy(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await delay(1000)
    if (await healthCheck()) {
      broadcastProgress('service-ready')
      completedSteps.add('service')
      return
    }
  }
  throw new Error('服务启动超时')
}

async function startService(): Promise<void> {
  // 仅重试启动进程，不重试健康检查轮询
  await withRetry(launchService, '启动服务')
  await waitForServiceHealthy()
}

async function connectAndLoadModel(config: StartConfig): Promise<void> {
  broadcastProgress('bridge-connecting')

  // 注册 Bridge 断开回调，触发自动恢复
  // state guard 防止恢复过程中递归触发（recovery 会将 state 设为 starting）
  transcriptionManager.onBridgeDisconnect(() => {
    if (state === 'running') {
      attemptRecovery()
    }
  })

  transcriptionManager.onReady(() => {
    broadcastProgress('model-ready')
    completedSteps.add('model')
  })

  let cancelled = false
  let checkInterval: ReturnType<typeof setInterval> | null = null
  let readyInterval: ReturnType<typeof setInterval> | null = null
  const cleanup = () => {
    cancelled = true
    if (checkInterval) { clearInterval(checkInterval); checkInterval = null }
    if (readyInterval) { clearInterval(readyInterval); readyInterval = null }
  }

  return new Promise<void>((resolve, reject) => {
    transcriptionManager.connectBridge({
      url: ASR_WS_URL,
      provider: config.provider || 'gguf',
      model: config.model || '',
      ...(config.overlapSec !== undefined ? { overlap_sec: config.overlapSec } : {}),
      ...(config.memoryChunks !== undefined ? { memory_chunks: config.memoryChunks } : {}),
    })

    checkInterval = setInterval(() => {
      if (cancelled) return
      if (transcriptionManager.isBridgeConnected()) {
        clearInterval(checkInterval!)
        checkInterval = null
        broadcastProgress('bridge-connected')
        completedSteps.add('bridge')

        readyInterval = setInterval(() => {
          if (cancelled) return
          if (transcriptionManager.isASRReady()) {
            clearInterval(readyInterval!)
            readyInterval = null
            if (!completedSteps.has('model')) {
              broadcastProgress('model-ready')
              completedSteps.add('model')
            }
            resolve()
          }
        }, 500)

        setTimeout(() => {
          if (cancelled) return
          cleanup()
          reject(new Error('模型加载超时'))
        }, 30000)
      }
    }, 500)

    setTimeout(() => {
      if (cancelled) return
      cleanup()
      reject(new Error('Bridge 连接超时'))
    }, 10000)
  })
}

async function startAudioSource(config: StartConfig): Promise<void> {
  broadcastProgress('source-starting')

  if (config.source === 'stream') {
    const url = config.streamUrl || DEFAULT_FLV_URL
    const { FLVSource } = await import('./audio-source/flv')
    const flvSource = new FLVSource(url)
    await flvSource.start()
    transcriptionManager.setStreamSource(flvSource)
  } else {
    // mic/file: 通知前端启动采集
    broadcast({ type: 'audio-source-start', data: { source: config.source } })
  }

  broadcastProgress('source-ready')
  completedSteps.add('source')
}

async function doStop(): Promise<void> {
  state = 'stopping'
  transcriptionManager.setManagerState('stopping')

  // 1. 停止音频源
  broadcastProgress('stopping-source')
  if (transcriptionManager.hasStreamSource()) {
    transcriptionManager.stopStreamSource()
  }
  broadcast({ type: 'audio-source-stop', data: {} })

  // 2. 断开 Bridge
  broadcastProgress('stopping-bridge')
  transcriptionManager.disconnectBridge()

  // 3. 停止服务
  broadcastProgress('stopping-service')
  stopASRProcess()

  transcriptionManager.resetState()
  state = 'idle'
  currentConfig = null
  completedSteps.clear()
  errorDetail = null
}

export const orchestrator = {
  async start(config: StartConfig): Promise<{ success: boolean; error?: string }> {
    if (state === 'starting' || state === 'running' || state === 'stopping') {
      return { success: false, error: '正在运行或操作中' }
    }

    state = 'starting'
    currentConfig = config
    completedSteps.clear()
    errorDetail = null
    stopSimulation()
    transcriptionManager.setSource(config.source)
    transcriptionManager.setStartTime()
    transcriptionManager.setManagerState('starting')

    try {
      // 1. 探测性健康检查
      broadcastProgress('health-checking')
      const isHealthy = await healthCheck()

      // 2. 如果未在线，启动服务
      if (!isHealthy) {
        await startService()
      } else {
        broadcastProgress('health-ok')
        completedSteps.add('service')
      }

      // 3. 连接 Bridge + 等待模型就绪
      if (!completedSteps.has('bridge')) {
        await withRetry(() => connectAndLoadModel(config), '连接 Bridge')
      }

      // 4. 启动音频源
      await withRetry(() => startAudioSource(config), '启动音频源')

      // 全部就绪
      state = 'running'
      transcriptionManager.setManagerState('running')
      transcriptionState.isActive = true
      transcriptionState.source = 'asr'

      return { success: true }
    } catch (e: any) {
      console.error(`[Orchestrator] 启动失败: ${e.message}`)
      state = 'error'
      errorDetail = e.message
      transcriptionManager.setManagerState('error')
      return { success: false, error: e.message }
    }
  },

  async stop(): Promise<void> {
    if (state === 'idle') return
    await doStop()
  },

  async switchSource(newSource: SourceType, streamUrl?: string): Promise<{ success: boolean; error?: string }> {
    if (state !== 'running') {
      return { success: false, error: '不在运行状态' }
    }

    try {
      // 停旧源
      if (transcriptionManager.hasStreamSource()) {
        transcriptionManager.stopStreamSource()
      }
      broadcast({ type: 'audio-source-stop', data: {} })

      // 启新源
      if (newSource === 'stream') {
        const url = streamUrl || DEFAULT_FLV_URL
        const { FLVSource } = await import('./audio-source/flv')
        const flvSource = new FLVSource(url)
        await flvSource.start()
        transcriptionManager.setStreamSource(flvSource)
      } else {
        broadcast({ type: 'audio-source-start', data: { source: newSource } })
      }

      transcriptionManager.setSource(newSource)
      transcriptionManager.broadcastStatus()

      if (currentConfig) {
        currentConfig.source = newSource
        if (streamUrl) currentConfig.streamUrl = streamUrl
      }

      return { success: true }
    } catch (e: any) {
      console.error(`[Orchestrator] 切换源失败: ${e.message}`)
      return { success: false, error: e.message }
    }
  },

  getStatus(): {
    state: OrchestratorState
    source: SourceType | null
    error: string | null
  } {
    return {
      state,
      source: currentConfig?.source ?? null,
      error: errorDetail
    }
  },

  isActive(): boolean {
    return state !== 'idle'
  },

  // 自动恢复：监听 Bridge 断开事件（由 transcription-manager 的 ws.on('close') 触发）
  // 此方法应在 Bridge 断开时被调用，尝试自动重连/重启
  async attemptRecovery(): Promise<void> {
    if (state !== 'running') return

    console.log('[Orchestrator] 检测到 Bridge 断开，开始自动恢复')
    state = 'starting'
    transcriptionManager.setManagerState('starting')

    // 暂停音频源
    if (transcriptionManager.hasStreamSource()) {
      transcriptionManager.stopStreamSource()
    }
    broadcast({ type: 'audio-source-stop', data: {} })

    try {
      // 尝试重连 Bridge
      broadcastProgress('bridge-connecting')
      await withRetry(() => connectAndLoadModel(currentConfig!), '重连 Bridge')

      // 恢复音频源
      if (currentConfig) {
        await startAudioSource(currentConfig)
      }

      state = 'running'
      transcriptionManager.setManagerState('running')
      console.log('[Orchestrator] 自动恢复成功')
    } catch (e: any) {
      console.error(`[Orchestrator] 自动恢复失败: ${e.message}`)
      // 尝试重启服务后再次恢复
      try {
        completedSteps.delete('service')
        completedSteps.delete('bridge')
        completedSteps.delete('model')
        broadcastProgress('service-starting')
        await launchService()
        await waitForServiceHealthy()
        await withRetry(() => connectAndLoadModel(currentConfig!), '重启后连接 Bridge')
        if (currentConfig) {
          await startAudioSource(currentConfig)
        }
        state = 'running'
        transcriptionManager.setManagerState('running')
        console.log('[Orchestrator] 重启服务后恢复成功')
      } catch (e2: any) {
        console.error(`[Orchestrator] 重启服务后恢复仍失败: ${e2.message}`)
        state = 'error'
        errorDetail = e2.message
        transcriptionManager.setManagerState('error')
      }
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add server/utils/transcription-orchestrator.ts
git commit -m "feat: 新增转录编排器，链式启动/停止/重试/热切换"
```

---

### Task 6: 新增 API 端点

**Files:**
- Create: `server/routes/api/transcription/start.ts`
- Create: `server/routes/api/transcription/stop.ts`
- Create: `server/routes/api/transcription/switch-source.ts`

- [ ] **Step 1: 创建 transcription/start.ts**

```typescript
import { orchestrator } from '../../../utils/transcription-orchestrator'

const VALID_SOURCES = ['mic', 'file', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { source, streamUrl, provider, model, overlapSec, memoryChunks } = body

  if (source && !VALID_SOURCES.includes(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    })
  }

  if (orchestrator.isActive()) {
    throw createError({
      statusCode: 409,
      statusMessage: '转录正在运行或操作中'
    })
  }

  const result = await orchestrator.start({
    source: (source || 'mic') as typeof VALID_SOURCES[number],
    streamUrl,
    provider,
    model,
    overlapSec,
    memoryChunks
  })

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: result.error || '启动失败'
    })
  }

  return { success: true, source: source || 'mic' }
})
```

- [ ] **Step 2: 创建 transcription/stop.ts**

```typescript
import { orchestrator } from '../../../utils/transcription-orchestrator'

export default defineEventHandler(async () => {
  await orchestrator.stop()
  return { success: true }
})
```

- [ ] **Step 3: 创建 transcription/switch-source.ts**

```typescript
import { orchestrator } from '../../../utils/transcription-orchestrator'

const VALID_SOURCES = ['mic', 'file', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { source, streamUrl } = body

  if (!source || !VALID_SOURCES.includes(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    })
  }

  const result = await orchestrator.switchSource(
    source as typeof VALID_SOURCES[number],
    streamUrl
  )

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: result.error || '切换失败'
    })
  }

  return { success: true, source }
})
```

- [ ] **Step 4: 提交**

```bash
git add server/routes/api/transcription/
git commit -m "feat: 新增转录 API 端点（start/stop/switch-source）"
```

---

### Task 7: 新增 useTranscription composable

**Files:**
- Create: `composables/useTranscription.ts`

- [ ] **Step 1: 实现 useTranscription composable**

```typescript
import type { WSMessage, TranscriptionStatusData, TranscriptionProgressData } from '~/types/websocket'

interface TranscriptionAudioState {
  active: boolean
  label: string
  detail?: string
}

interface TranscriptionRecognitionState {
  active: boolean
  detail?: string
}

export function useTranscription() {
  const state = ref<'idle' | 'starting' | 'running' | 'stopping' | 'error'>('idle')
  const audio = ref<TranscriptionAudioState>({ active: false, label: '' })
  const recognition = ref<TranscriptionRecognitionState>({ active: false, detail: '已停止' })
  const error = ref<string | undefined>()
  const uptime = ref(0)
  const connectionCount = ref(0)
  const subtitleCount = ref(0)
  const currentStep = ref<string | null>(null)

  let uptimeInterval: ReturnType<typeof setInterval> | null = null

  function startUptimeCounter() {
    if (uptimeInterval) return
    const baseTime = Date.now() - uptime.value * 1000
    uptimeInterval = setInterval(() => {
      uptime.value = Math.floor((Date.now() - baseTime) / 1000)
    }, 1000)
  }

  function stopUptimeCounter() {
    if (uptimeInterval) {
      clearInterval(uptimeInterval)
      uptimeInterval = null
    }
  }

  function handleWSMessage(message: WSMessage) {
    switch (message.type) {
      case 'transcription-status': {
        const data = message.data as TranscriptionStatusData
        state.value = data.state
        audio.value = data.audio
        recognition.value = data.recognition
        error.value = data.error
        if (data.uptime > 0) {
          uptime.value = data.uptime
          if (data.state === 'running') startUptimeCounter()
          else stopUptimeCounter()
        }
        if (data.state === 'idle' || data.state === 'error') {
          stopUptimeCounter()
          if (data.state === 'idle') {
            uptime.value = 0
            subtitleCount.value = 0
          }
        }
        break
      }
      case 'transcription-progress': {
        const data = message.data as TranscriptionProgressData
        currentStep.value = data.step
        break
      }
      case 'connection-count': {
        const data = message.data as { count: number }
        connectionCount.value = data.count
        break
      }
      case 'confirmed': {
        subtitleCount.value++
        break
      }
    }
  }

  async function startTranscription(config: { source: string; streamUrl?: string; provider?: string; overlapSec?: number; memoryChunks?: number }) {
    try {
      await $fetch('/api/transcription/start', {
        method: 'POST',
        body: config
      })
    } catch (e: any) {
      error.value = e?.data?.message || e.message || '启动失败'
    }
  }

  async function stopTranscription() {
    try {
      await $fetch('/api/transcription/stop', { method: 'POST' })
    } catch (e: any) {
      console.error('停止失败:', e)
    }
  }

  async function switchSource(config: { source: string; streamUrl?: string }) {
    try {
      await $fetch('/api/transcription/switch-source', {
        method: 'POST',
        body: config
      })
    } catch (e: any) {
      error.value = e?.data?.message || e.message || '切换失败'
    }
  }

  onUnmounted(() => {
    stopUptimeCounter()
  })

  return {
    state: readonly(state),
    audio: readonly(audio),
    recognition: readonly(recognition),
    error: readonly(error),
    uptime: readonly(uptime),
    connectionCount: readonly(connectionCount),
    subtitleCount: readonly(subtitleCount),
    currentStep: readonly(currentStep),
    handleWSMessage,
    startTranscription,
    stopTranscription,
    switchSource
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add composables/useTranscription.ts
git commit -m "feat: 新增 useTranscription composable，管理 WS 推送的转录状态"
```

---

### Task 8: 新增 TranscriptionControlPanel 组件

**Files:**
- Create: `components/admin/TranscriptionControlPanel.vue`

- [ ] **Step 1: 实现合并后的转录控制面板**

此组件合并了 ASRControlPanel 和 ModelStatusPanel 的功能。复制 `components/admin/ASRControlPanel.vue` 的音频源 UI 部分，加上新的状态展示和一键控制逻辑。

组件结构：
- 音频源选择区域（mic/file/stream 三个按钮）
- 源配置区域（按当前选择的源显示不同 UI）
- 状态展示区域（总状态 + 音频状态 + 识别状态 + 运行时长）
- 开始/停止按钮
- 折叠的高级区域（引擎选择 + 高级参数 + 服务控制）

使用 `useTranscription` composable 管理 WS 状态，使用 `useAudioCapture` 和 `useAudioFilePlayer` 处理音频采集/播放。音频采集/播放的启停由 WS 消息 `audio-source-start` / `audio-source-stop` 驱动，而非用户直接操作。

由于此组件较大（约 600-800 行，包含模板、脚本和样式），实现时应参考现有 `ASRControlPanel.vue` 的样式和 `ModelStatusPanel.vue` 的状态展示逻辑。保持与现有面板一致的视觉风格（Orbitron 字体、渐变背景、状态颜色）。

关键行为：
1. `onMounted` 时枚举设备、加载 ASR 默认配置，但不启动 mic 采集
2. 监听 `useTranscription.handleWSMessage` 处理 WS 消息
3. 收到 `audio-source-start` 时启动对应音频源（mic 采集 / file 播放）
4. 收到 `audio-source-stop` 时停止当前音频源
5. 点"开始转录"调用 `startTranscription()`
6. 点"停止转录"调用 `stopTranscription()`
7. 运行中切换源按钮调用 `switchSource()`
8. 高级区域的服务控制按钮调用 `/api/asr/service-start` 和 `/api/asr/service-stop`

- [ ] **Step 2: 提交**

```bash
git add components/admin/TranscriptionControlPanel.vue
git commit -m "feat: 新增 TranscriptionControlPanel 合并面板"
```

---

### Task 9: admin.vue 集成

**Files:**
- Modify: `pages/admin.vue`

- [ ] **Step 1: 更新 admin.vue，替换面板组件**

变更要点：
1. 移除 `asrPanelRef`、`asrSourceConfig`、`asrIsLoading` 等旧状态
2. 移除 `handleSourceSave`、`handleASRStart`、`handleASRStop` 等旧方法
3. 移除 `fetchStatus` 轮询及其 `statusInterval` 定时器
4. 新增 `useTranscription()` 实例，在 `useWebSocket` 的 `onMessage` 回调中同时调用 `useSubtitles().handleMessage(msg)` 和 `transcription.handleWSMessage(msg)`
5. 将 `<AdminASRControlPanel>` 和 `<AdminModelStatusPanel>` 替换为 `<AdminTranscriptionControlPanel>`
6. 状态栏中的 `status?.connectionCount` 替换为 `transcription.connectionCount.value`，`status?.subtitleCount` 替换为 `transcription.subtitleCount.value`
7. 如果模拟器不需要 `/api/status` 轮询，也一并移除

```html
<!-- 替换旧面板 -->
<AdminTranscriptionControlPanel
  :connection-count="transcription.connectionCount.value"
  :subtitle-count="transcription.subtitleCount.value"
  @status-change="handleTranscriptionStatusChange"
/>
```

- [ ] **Step 2: 提交**

```bash
git add pages/admin.vue
git commit -m "feat: admin.vue 集成 TranscriptionControlPanel，移除旧面板引用"
```

---

### Task 10: 清理旧文件和残留引用

**Files:**
- Delete: `components/admin/ASRControlPanel.vue`
- Delete: `components/admin/ModelStatusPanel.vue`
- Modify: `types/websocket.ts` — 移除 `'status'` 消息类型和 `WSStatusData`

> **注意：** `server/routes/api/asr/start.ts`、`server/routes/api/asr/stop.ts` 和 `server/routes/api/asr/status.ts` 已在 Task 3 中删除。`/api/asr/service-health.ts` 可保留（高级面板仍可手动检查）或在此处删除。

- [ ] **Step 1: 删除旧组件文件**

```bash
rm components/admin/ASRControlPanel.vue
rm components/admin/ModelStatusPanel.vue
```

- [ ] **Step 2: 从 WSMessageType 中移除废弃的 'status' 类型**

在 `types/websocket.ts` 中：
- 移除 `'status'` 从 `WSMessageType` 联合类型
- 删除 `WSStatusData` 接口
- 从 `WSMessage.data` 联合类型中移除 `WSStatusData`

- [ ] **Step 3: 检查残留引用**

```bash
grep -r "ASRControlPanel\|ModelStatusPanel" --include="*.vue" --include="*.ts" .
grep -r "WSStatusData\|'status'" --include="*.vue" --include="*.ts" .
```

修复所有残留引用。

- [ ] **Step 4: 提交**

```bash
git add components/admin/ASRControlPanel.vue components/admin/ModelStatusPanel.vue types/websocket.ts
git commit -m "chore: 删除旧面板组件，移除废弃的 status 消息类型"
```

---

### Task 11: 构建验证

- [ ] **Step 1: 运行构建检查类型错误**

```bash
pnpm build
```

修复所有 TypeScript 编译错误。

- [ ] **Step 2: 启动开发服务器验证**

```bash
pnpm dev
```

在浏览器中打开 admin 页面，验证：
1. 面板正确显示
2. 状态默认为 idle
3. 音频源选择 UI 正常
4. 高级区域折叠/展开正常
5. 控制台无错误

- [ ] **Step 3: 修复发现的问题并提交**

```bash
git add <具体修改的文件>
git commit -m "fix: 修复构建和开发服务器验证中发现的问题"
```
