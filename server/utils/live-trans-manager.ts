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
      reconnectCount: status?.reconnectCount
    }
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
    uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
  }
}

export const liveTransManager = {
  start,
  stop,
  getStatus
}
