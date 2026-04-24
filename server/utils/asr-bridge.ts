import { WebSocket } from 'ws'
import type { WSMessage, WSCurrentData, WSConfirmedData, WSAIProcessedData } from '../../types/websocket'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
import { stopSimulation } from './simulator'
import { processAI } from './ai-processor'

type BridgeStatus = 'disconnected' | 'connecting' | 'connected'

let ws: WebSocket | null = null
let status: BridgeStatus = 'disconnected'
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let config: { url: string; provider: string; model: string } | null = null
let onReadyCallback: (() => void) | null = null

let partialVersion = 0

function connect() {
  if (!config || status === 'connected') return

  status = 'connecting'

  try {
    ws = new WebSocket(config.url)

    ws.on('open', () => {
      status = 'connected'
      console.log(`[ASR Bridge] 已连接: ${config.url}`)

      ws.send(JSON.stringify({
        type: 'config',
        provider: config.provider,
        model: config.model
      }))
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'partial' || msg.type === 'final') {
          processResult(msg)
        } else if (msg.type === 'error') {
          console.error(`[ASR Bridge] Python 错误: ${msg.message}`)
        } else if (msg.type === 'loading') {
          console.log('[ASR Bridge] 模型加载中...')
        } else if (msg.type === 'ready') {
          console.log('[ASR Bridge] 模型就绪')
          if (onReadyCallback) {
            onReadyCallback()
          }
        } else if (msg.type === 'unloaded') {
          console.log('[ASR Bridge] 模型已卸载')
        }
      } catch (e) {
        console.error('[ASR Bridge] 消息解析失败:', e)
      }
    })

    ws.on('close', () => {
      status = 'disconnected'
      console.log('[ASR Bridge] 连接断开')
      scheduleReconnect()
    })

    ws.on('error', (err: Error) => {
      status = 'disconnected'
      console.error('[ASR Bridge] 连接错误:', err.message)
    })
  } catch (e) {
    status = 'disconnected'
    console.error('[ASR Bridge] 创建连接失败:', e)
    scheduleReconnect()
  }
}

export function setOnReadyCallback(cb: (() => void) | null): void {
  onReadyCallback = cb
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 3000)
}

function processResult(result: { type: string; text: string; language: string }) {
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

export function startASR(
  bridgeConfig: { url: string; provider: string; model: string },
  source: 'mic' | 'stream',
  streamUrl?: string
): boolean {
  if (status === 'connected') {
    stopASR()
  }

  config = bridgeConfig

  stopSimulation()

  transcriptionState.isActive = true
  transcriptionState.source = 'asr'

  connect()
  return true
}

export function stopASR(): void {
  transcriptionState.isActive = false
  transcriptionState.source = null
  transcriptionState.currentSubtitle = null

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (ws) {
    ws.close()
    ws = null
  }

  status = 'disconnected'
  onReadyCallback = null
  config = null
  partialVersion = 0
}

export function getASRStatus() {
  return {
    isActive: transcriptionState.source === 'asr',
    bridgeStatus: status,
    provider: config?.provider ?? null,
    modelLoaded: status === 'connected'
  }
}

export function sendAudioChunk(base64Pcm: string): boolean {
  if (!ws || status !== 'connected') return false
  try {
    ws.send(JSON.stringify({ type: 'audio', data: base64Pcm }))
    return true
  } catch {
    return false
  }
}
