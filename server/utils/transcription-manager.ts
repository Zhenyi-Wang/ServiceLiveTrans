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

// === 音频源回调 ===

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

    // ASR 就绪回调（在 bridgeConnect 之前设置）
    onReadyCallback = () => {
      // 发送缓存的音频
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
    if (!asrReady) {
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

  isActive(): boolean {
    return managerState !== 'idle'
  }
}
