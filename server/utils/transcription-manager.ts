import { WebSocket } from 'ws'
import type { WSMessage, WSCurrentData, WSConfirmedData, TranscriptionStatusData } from '../../types/websocket'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
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

export function getStatusData(): TranscriptionStatusData {
  const sourceLabel = currentSource === 'mic' ? '麦克风' : currentSource === 'file' ? '文件' : currentSource === 'stream' ? '直播流' : ''
  const sourceStatus = audioSource?.getStatus()
  const audioDetail = sourceStatus
    ? (sourceStatus.state === 'running' ? '运行中' : sourceStatus.state === 'connecting' ? '连接中' : sourceStatus.state === 'error' ? '错误' : undefined)
    : (managerState === 'running' && currentSource ? '运行中' : undefined)

  return {
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
}

export function broadcastStatus(): void {
  broadcast({ type: 'transcription-status', data: getStatusData() })
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
    bridgeDisconnectCallback = null
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
