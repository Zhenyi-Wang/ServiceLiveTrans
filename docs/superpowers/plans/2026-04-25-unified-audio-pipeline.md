# 统一音频管道实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 asr-bridge 和 liveTransManager 统一为 transcriptionManager，所有音频源（mic/file/stream）共用同一个 ASR 连接和管理器。

**Architecture:** 新建 `server/utils/transcription-manager.ts` 作为唯一的转录管理器，内聚 ASR Bridge WebSocket 连接管理、服务端音频源管理（FLVSource）、transcriptionState 维护。所有 API 路由委托给 transcriptionManager。前端合并 LiveTransControl 到 ASRControlPanel。

**Tech Stack:** Nuxt 4 / Nitro / TypeScript / ws (WebSocket) / child_process (ffmpeg)

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `server/utils/transcription-manager.ts` | 统一转录管理器（ASR Bridge + 音频源 + 状态） |
| 重写 | `server/routes/api/asr/start.ts` | 委托给 transcriptionManager.start() |
| 重写 | `server/routes/api/asr/stop.ts` | 委托给 transcriptionManager.stop() |
| 重写 | `server/routes/api/asr/status.ts` | 委托给 transcriptionManager.getStatus() |
| 修改 | `server/routes/api/ws.ts` | import 改为 transcriptionManager |
| 重写 | `server/routes/api/live/start.ts` | 委托给 transcriptionManager.start() |
| 重写 | `server/routes/api/live/stop.ts` | 委托给 transcriptionManager.stop() |
| 重写 | `server/routes/api/live/status.ts` | 委托给 transcriptionManager.getStatus() |
| 删除 | `server/utils/asr-bridge.ts` | 功能合并到 transcription-manager.ts |
| 删除 | `server/utils/live-trans-manager.ts` | 功能合并到 transcription-manager.ts |
| 修改 | `components/admin/ASRControlPanel.vue` | 移除 LiveTrans 互斥检查 |
| 删除 | `components/admin/LiveTransControl.vue` | 功能已在 ASRControlPanel 中 |
| 修改 | `pages/admin.vue` | 移除 LiveTrans 相关状态和处理函数，移除 LiveTransControl 组件 |

---

### Task 1: 创建 TranscriptionManager 核心模块

**Files:**
- Create: `server/utils/transcription-manager.ts`
- Read (reference): `server/utils/asr-bridge.ts`
- Read (reference): `server/utils/live-trans-manager.ts`
- Read (reference): `server/utils/audio-source/flv.ts`
- Read (reference): `server/utils/audio-source/base.ts`

- [ ] **Step 1: 创建 transcription-manager.ts**

将 asr-bridge 的 WebSocket 连接管理、processResult、AI 处理逻辑和 liveTransManager 的音频源管理、pendingAudio 缓冲逻辑合并到一个文件中。

```typescript
import { WebSocket } from 'ws'
import type { WSMessage, WSCurrentData, WSConfirmedData } from '../../types/websocket'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
import { stopSimulation } from './simulator'
import { processAI } from './ai-processor'
import type { AudioSource, AudioSourceStatus } from './audio-source/base'
import { FLVSource } from './audio-source/flv'

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
  uptime: number
}

const DEFAULT_FLV_URL = process.env.FLV_STREAM_URL || 'http://mini:8080/live/livestream.flv'

// ASR Bridge 内部状态
let ws: WebSocket | null = null
let bridgeStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let bridgeConfig: { url: string; provider: string; model: string } | null = null
let onReadyCallback: (() => void) | null = null
let partialVersion = 0

// 音频源状态
let audioSource: AudioSource | null = null
let currentSource: SourceType | null = null
let asrReady = false
let pendingAudio: Buffer[] = []
let startTime: number | null = null
let stateCheckInterval: ReturnType<typeof setInterval> | null = null
let managerState: 'idle' | 'starting' | 'running' | 'error' = 'idle'

// === ASR Bridge (内部) ===

function bridgeConnect(): void {
  if (!bridgeConfig || bridgeStatus === 'connected') return
  bridgeStatus = 'connecting'

  try {
    ws = new WebSocket(bridgeConfig.url)

    ws.on('open', () => {
      bridgeStatus = 'connected'
      console.log(`[TranscriptionManager] ASR 已连接: ${bridgeConfig!.url}`)

      ws!.send(JSON.stringify({
        type: 'config',
        provider: bridgeConfig!.provider,
        model: bridgeConfig!.model
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
          onReadyCallback?.()
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
      scheduleBridgeReconnect()
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
}

function scheduleBridgeReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    bridgeConnect()
  }, 3000)
}

function bridgeDisconnect(): void {
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

// === ASR 结果处理 (从 asr-bridge 移植) ===

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

// === 音频源回调 (从 live-trans-manager 移植) ===

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
  _broadcastStatus()
}

function _broadcastStatus(): void {
  broadcast({
    type: 'status',
    data: {
      state: managerState,
      source: currentSource,
      error: undefined,
      reconnectCount: audioSource?.getStatus().reconnectCount
    }
  })
}

// === 公开 API ===

export const transcriptionManager = {
  async start(config: StartConfig): Promise<boolean> {
    if (managerState !== 'idle') {
      return false
    }

    managerState = 'starting'
    currentSource = config.source
    startTime = Date.now()
    _broadcastStatus()

    stopSimulation()

    // 连接 ASR Bridge
    const asrUrl = process.env.ASR_WS_URL || 'ws://localhost:9900'
    bridgeConfig = { url: asrUrl, provider: config.provider, model: config.model }

    transcriptionState.isActive = true
    transcriptionState.source = 'asr'

    bridgeConnect()

    // stream 源：创建 FLVSource
    if (config.source === 'stream') {
      try {
        const url = config.streamUrl || DEFAULT_FLV_URL
        audioSource = new FLVSource(url)
        audioSource.onAudio(_onAudio)
        audioSource.onError(_onError)
        await audioSource.start()

        stateCheckInterval = setInterval(() => {
          if (managerState === 'idle' || !audioSource) {
            clearInterval(stateCheckInterval!)
            stateCheckInterval = null
            return
          }
          const sourceStatus = audioSource.getStatus()
          if (sourceStatus.state === 'running' && asrReady) {
            managerState = 'running'
          } else if (sourceStatus.state === 'connecting') {
            managerState = 'starting'
          } else if (sourceStatus.state === 'error') {
            managerState = 'error'
          }
        }, 2000)
      } catch (e) {
        console.error(`[TranscriptionManager] 音频源启动失败: ${e}`)
        audioSource?.stop()
        audioSource = null
        bridgeDisconnect()
        asrReady = false
        pendingAudio = []
        onReadyCallback = null
        bridgeConfig = null
        transcriptionState.isActive = false
        transcriptionState.source = null
        managerState = 'idle'
        currentSource = null
        startTime = null
        _broadcastStatus()
        return false
      }
    } else {
      // mic/file：前端推送音频，后端不创建音频源
    }

    // ASR 就绪回调（在 bridgeConnect 之前设置，message handler 中触发）
    onReadyCallback = () => {
      // 发送缓存的音频（如果有）
      for (const pcm of pendingAudio) {
        sendAudioChunkToASR(pcm.toString('base64'))
      }
      pendingAudio = []

      // mic/file 无服务端音频源，直接进入 running
      if (!audioSource) {
        managerState = 'running'
        _broadcastStatus()
      }
      // stream：由 stateCheckInterval 检测 audioSource 状态后进入 running
    }

    return true
  },

  stop(): void {
    if (managerState === 'idle') return

    managerState = 'idle'
    _broadcastStatus()

    audioSource?.stop()
    audioSource = null
    currentSource = null

    if (stateCheckInterval) {
      clearInterval(stateCheckInterval)
      stateCheckInterval = null
    }

    bridgeDisconnect()

    asrReady = false
    pendingAudio = []
    onReadyCallback = null
    bridgeConfig = null
    startTime = null

    transcriptionState.isActive = false
    transcriptionState.source = null
    transcriptionState.currentSubtitle = null
    transcriptionState.confirmedSubtitles = []
  },

  sendAudioChunk(base64Pcm: string): boolean {
    // 前端推送的音频（mic/file）
    if (!asrReady) {
      // ASR 未就绪时缓存
      pendingAudio.push(Buffer.from(base64Pcm, 'base64'))
      if (pendingAudio.length * 0.1 > 10) {
        pendingAudio.shift()
      }
      return false
    }
    return sendAudioChunkToASR(base64Pcm)
  },

  getStatus(): TranscriptionStatus {
    return {
      state: managerState,
      source: currentSource,
      asrConnected: bridgeStatus === 'connected',
      asrProvider: bridgeConfig?.provider ?? null,
      sourceStatus: audioSource?.getStatus(),
      uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
    }
  },

  setOnReadyCallback(cb: (() => void) | null): void {
    onReadyCallback = cb
  },

  isActive(): boolean {
    return managerState !== 'idle'
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/transcription-manager.ts
git commit -m "feat: 创建统一转录管理器 TranscriptionManager"
```

---

### Task 2: 重写 API 路由，委托给 TranscriptionManager

**Files:**
- Rewrite: `server/routes/api/asr/start.ts`
- Rewrite: `server/routes/api/asr/stop.ts`
- Rewrite: `server/routes/api/asr/status.ts`
- Modify: `server/routes/api/ws.ts`
- Rewrite: `server/routes/api/live/start.ts`
- Rewrite: `server/routes/api/live/stop.ts`
- Rewrite: `server/routes/api/live/status.ts`

- [ ] **Step 1: 重写 asr/start.ts**

```typescript
import { transcriptionManager } from '../../../utils/transcription-manager'
import { startASRProcess } from '../../../utils/asr-process'

const VALID_SOURCES = ['mic', 'file', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { provider, model, source, streamUrl } = body

  if (source && !VALID_SOURCES.includes(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    })
  }

  if (transcriptionManager.isActive()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Transcription already running'
    })
  }

  const resolvedSource = (source || 'mic') as typeof VALID_SOURCES[number]

  // spawn ASR 进程（如果未运行）
  let spawned = false
  try {
    const result = await startASRProcess()
    spawned = result !== null
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'ASR 进程启动失败'
    })
  }

  const success = await transcriptionManager.start({
    provider: provider || 'gguf',
    model: model || '',
    source: resolvedSource,
    streamUrl
  })

  if (!success) {
    throw createError({
      statusCode: 500,
      statusMessage: '转录启动失败'
    })
  }

  return {
    success: true,
    spawned,
    provider,
    source: resolvedSource
  }
})
```

- [ ] **Step 2: 重写 asr/stop.ts**

```typescript
import { transcriptionManager } from '../../../utils/transcription-manager'
import { stopASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(() => {
  transcriptionManager.stop()
  stopASRProcess()
  return { success: true, message: 'ASR stopped' }
})
```

- [ ] **Step 3: 重写 asr/status.ts**

```typescript
import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(() => {
  const status = transcriptionManager.getStatus()
  return {
    isActive: status.state !== 'idle',
    bridgeStatus: status.asrConnected ? 'connected' : 'disconnected',
    provider: status.asrProvider,
    modelLoaded: status.asrConnected,
    source: status.source
  }
})
```

- [ ] **Step 4: 修改 ws.ts — 替换 import**

将 `import { sendAudioChunk } from '../../utils/asr-bridge'` 改为 `import { transcriptionManager } from '../../utils/transcription-manager'`，并将 `sendAudioChunk(data.data)` 改为 `transcriptionManager.sendAudioChunk(data.data)`。

完整文件：

```typescript
import type { WSMessage } from '../../../types/websocket'
import { addConnection, removeConnection, sendTo } from '../../utils/websocket'
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
        confirmed: transcriptionState.confirmedSubtitles
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

- [ ] **Step 5: 重写 live/start.ts（向后兼容）**

```typescript
import { transcriptionManager } from '../../../utils/transcription-manager'
import { startASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { sourceType, streamUrl } = body

  if (!sourceType || !['flv', 'mic'].includes(sourceType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType must be "flv" or "mic"'
    })
  }

  if (transcriptionManager.isActive()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Transcription already running'
    })
  }

  let spawned = false
  try {
    const result = await startASRProcess()
    spawned = result !== null
  } catch {
    // 进程已运行
  }

  const success = await transcriptionManager.start({
    provider: 'gguf',
    model: '',
    source: 'stream',
    streamUrl
  })

  return { success, sourceType }
})
```

- [ ] **Step 6: 重写 live/stop.ts**

```typescript
import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(() => {
  transcriptionManager.stop()
  return { success: true }
})
```

- [ ] **Step 7: 重写 live/status.ts**

```typescript
import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(() => {
  const status = transcriptionManager.getStatus()
  return {
    state: status.state,
    sourceType: status.source === 'stream' ? 'flv' : status.source,
    reconnectCount: status.sourceStatus?.reconnectCount ?? 0,
    uptime: status.uptime
  }
})
```

- [ ] **Step 8: Commit**

```bash
git add server/routes/api/asr/start.ts server/routes/api/asr/stop.ts server/routes/api/asr/status.ts server/routes/api/ws.ts server/routes/api/live/start.ts server/routes/api/live/stop.ts server/routes/api/live/status.ts
git commit -m "refactor: API 路由统一委托给 TranscriptionManager"
```

---

### Task 3: 删除旧模块

**Files:**
- Delete: `server/utils/asr-bridge.ts`
- Delete: `server/utils/live-trans-manager.ts`

- [ ] **Step 1: 确认没有遗漏的 import**

Run: `grep -rn 'from.*asr-bridge\|from.*live-trans-manager' server/ --include='*.ts'`

Expected: 无输出（所有 import 已在 Task 2 中替换）

- [ ] **Step 2: 删除旧文件**

```bash
rm server/utils/asr-bridge.ts server/utils/live-trans-manager.ts
```

- [ ] **Step 3: 验证编译无报错**

Run: `pnpm dev`，确认服务启动无报错，无模块找不到的错误。

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor: 删除 asr-bridge 和 liveTransManager 旧模块"
```

---

### Task 4: 前端合并 — 移除 LiveTransControl

**Files:**
- Modify: `pages/admin.vue`
- Delete: `components/admin/LiveTransControl.vue`
- Modify: `components/admin/ASRControlPanel.vue`

- [ ] **Step 1: 修改 ASRControlPanel.vue — 移除 LiveTrans 互斥检查**

在 `handleStart()` 函数中，移除以下互斥检查代码块（因为现在只有一个管理器，不存在互斥问题）：

```typescript
// 删除这段代码
try {
  const liveStatus = await $fetch<{ state: string }>('/api/live/status')
  if (liveStatus.state !== 'idle') {
    setStatus('请先停止直播转录', 'error')
    return
  }
} catch {
  // live status API 不可用时忽略
}
```

- [ ] **Step 2: 修改 pages/admin.vue — 移除 LiveTrans 相关代码**

在 `<script setup>` 中移除：
1. `liveIsRunning` ref 和 `liveIsLoading` ref
2. `handleLiveStart` 函数
3. `handleLiveStop` 函数

在 `<template>` 中移除 `AdminLiveTransControl` 组件（约第 355-361 行）。

- [ ] **Step 3: 删除 LiveTransControl.vue**

```bash
rm components/admin/LiveTransControl.vue
```

- [ ] **Step 4: 验证前端编译和渲染**

Run: `pnpm dev`，打开 `http://localhost:3000/admin`，确认：
- 页面正常渲染，无控制台报错
- ASR ControlPanel 显示三个源选项（Microphone、File、Stream）
- 不再显示 LiveTransControl 面板

- [ ] **Step 5: Commit**

```bash
git add pages/admin.vue components/admin/ASRControlPanel.vue
git rm components/admin/LiveTransControl.vue
git commit -m "refactor: 合并前端控制面板，移除 LiveTransControl"
```

---

### Task 5: 验证完整功能

**Files:** 无新文件修改

- [ ] **Step 1: 验证服务启动无报错**

Run: `pnpm dev`，确认：
- 服务启动成功，无 `Cannot find module` 错误
- 无 TypeScript 类型错误

- [ ] **Step 2: 验证 /api/asr/status 返回正确格式**

Run: `curl http://localhost:3000/api/asr/status`

Expected:
```json
{"isActive":false,"bridgeStatus":"disconnected","provider":null,"modelLoaded":false,"source":null}
```

- [ ] **Step 3: 验证 /api/live/status 返回正确格式**

Run: `curl http://localhost:3000/api/live/status`

Expected:
```json
{"state":"idle","sourceType":null,"reconnectCount":0,"uptime":0}
```

- [ ] **Step 4: 验证 Stream 源启动和停止**

在 admin 页面选择 Stream 源，点击 START：
- 确认 ASR 进程启动
- 确认 ASR Bridge 连接成功（状态变为 running）
- 确认有字幕输出
- 点击 STOP，确认转录停止

- [ ] **Step 5: 验证 Mic 源启动和停止**

选择 Microphone 源，点击 START：
- 确认浏览器请求麦克风权限
- 对着麦克风说话，确认有字幕输出
- 点击 STOP，确认转录停止

- [ ] **Step 6: 验证互斥（只能同时运行一个转录）**

启动 Stream 源后，尝试再次点击 START，确认被拒绝（返回 409）。

- [ ] **Step 7: Commit（如有修复）**

如果验证过程中发现 bug 并修复，提交修复。否则跳过。
