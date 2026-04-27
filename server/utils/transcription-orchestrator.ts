import { transcriptionManager, broadcastStatus, type SourceType } from './transcription-manager'
import { getASRServiceHealth, startASRProcess } from './asr-process'
import { broadcast } from './websocket'
import { transcriptionState } from './transcription-state'
import { stopSimulation } from './simulator'
import type { TranscriptionProgressData } from '../../types/websocket'
import type { ASRConfig } from '../../types/asr'
import { asrConfigToSnake } from '../../types/asr'

const DEFAULT_FLV_URL = process.env.FLV_STREAM_URL || 'http://mini:8080/live/livestream.flv'
const ASR_WS_URL = process.env.ASR_WS_URL || 'ws://localhost:9900'

type OrchestratorState = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

interface StartConfig extends ASRConfig {
  source: SourceType
  streamUrl?: string
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
      console.log(`[Orchestrator] ${stepName} 失败，${delays[i]! / 1000}s 后重试 (${i + 1}/${maxRetries}): ${e.message}`)
      await delay(delays[i]!)
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
  await withRetry(launchService, '启动服务')
  await waitForServiceHealthy()
}

async function connectAndLoadModel(config: StartConfig): Promise<void> {
  broadcastProgress('bridge-connecting')

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
  let modelTimeout: ReturnType<typeof setTimeout> | null = null
  let bridgeTimeout: ReturnType<typeof setTimeout> | null = null
  const cleanup = () => {
    cancelled = true
    if (checkInterval) { clearInterval(checkInterval); checkInterval = null }
    if (readyInterval) { clearInterval(readyInterval); readyInterval = null }
    if (modelTimeout) { clearTimeout(modelTimeout); modelTimeout = null }
    if (bridgeTimeout) { clearTimeout(bridgeTimeout); bridgeTimeout = null }
  }

  return new Promise<void>((resolve, reject) => {
    transcriptionManager.connectBridge({
      url: ASR_WS_URL,
      provider: config.provider || 'gguf',
      model: config.model || '',
      ...asrConfigToSnake(config),
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
            cleanup()
            if (!completedSteps.has('model')) {
              broadcastProgress('model-ready')
              completedSteps.add('model')
            }
            resolve()
          }
        }, 500)

        modelTimeout = setTimeout(() => {
          if (cancelled) return
          cleanup()
          reject(new Error('模型加载超时'))
        }, 30000)
      }
    }, 500)

    bridgeTimeout = setTimeout(() => {
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
    broadcast({ type: 'audio-source-start', data: { source: config.source } })
  }

  broadcastProgress('source-ready')
  completedSteps.add('source')
}

function updateOverallState(): void {
  const audioActive = transcriptionManager.hasStreamSource() || transcriptionManager.getSource() !== null
  const recognitionActive = transcriptionManager.isBridgeConnected() && transcriptionManager.isASRReady()

  if (audioActive || recognitionActive) {
    state = 'running'
    transcriptionManager.setManagerState('running')
    transcriptionState.isActive = true
    transcriptionState.source = 'asr'
  } else {
    transcriptionManager.resetState()
    state = 'idle'
    currentConfig = null
    completedSteps.clear()
    errorDetail = null
  }
  broadcastStatus()
  broadcast({ type: 'transcription-progress', data: { step: '' } })
}

async function doStop(): Promise<void> {
  state = 'stopping'
  transcriptionManager.setManagerState('stopping')

  broadcastProgress('stopping-source')
  if (transcriptionManager.hasStreamSource()) {
    transcriptionManager.stopStreamSource()
  }
  broadcast({ type: 'audio-source-stop', data: {} })

  broadcastProgress('stopping-bridge')
  transcriptionManager.disconnectBridge()

  transcriptionManager.resetState()
  state = 'idle'
  currentConfig = null
  completedSteps.clear()
  errorDetail = null
  broadcastStatus()
}

export const orchestrator = {
  async start(config: StartConfig): Promise<{ success: boolean; error?: string }> {
    if (state === 'starting' || state === 'stopping') {
      return { success: false, error: '正在操作中' }
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
      const asrReady = transcriptionManager.isBridgeConnected() && transcriptionManager.isASRReady()

      if (!asrReady) {
        broadcastProgress('health-checking')
        const isHealthy = await healthCheck()

        if (!isHealthy) {
          await startService()
        } else {
          broadcastProgress('health-ok')
          completedSteps.add('service')
        }

        if (!completedSteps.has('bridge')) {
          await withRetry(() => connectAndLoadModel(config), '连接 Bridge')
        }
      }

      if (!completedSteps.has('source')) {
        await withRetry(() => startAudioSource(config), '启动音频源')
      }

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

  async startAudioOnly(config: { source: SourceType; streamUrl?: string }): Promise<{ success: boolean; error?: string }> {
    if (transcriptionManager.getSource() !== null) {
      return { success: false, error: '音频源已在运行' }
    }

    currentConfig = currentConfig || { source: config.source, streamUrl: config.streamUrl }
    currentConfig.source = config.source
    if (config.streamUrl) currentConfig.streamUrl = config.streamUrl

    transcriptionManager.setSource(config.source)
    if (!transcriptionManager.getStartTime()) {
      transcriptionManager.setStartTime()
    }

    try {
      await startAudioSource(currentConfig)
      updateOverallState()
      return { success: true }
    } catch (e: any) {
      console.error(`[Orchestrator] 启动音频源失败: ${e.message}`)
      return { success: false, error: e.message }
    }
  },

  async stopAudioOnly(): Promise<void> {
    broadcastProgress('stopping-source')
    if (transcriptionManager.hasStreamSource()) {
      transcriptionManager.stopStreamSource()
    }
    broadcast({ type: 'audio-source-stop', data: {} })

    transcriptionManager.clearAudioSource()
    completedSteps.delete('source')
    updateOverallState()
  },

  async startRecognitionOnly(config: ASRConfig): Promise<{ success: boolean; error?: string }> {
    if (transcriptionManager.isBridgeConnected() && transcriptionManager.isASRReady()) {
      return { success: false, error: '识别服务已在运行' }
    }

    try {
      broadcastProgress('health-checking')
      const isHealthy = await healthCheck()

      if (!isHealthy) {
        await startService()
      } else {
        broadcastProgress('health-ok')
        completedSteps.add('service')
      }

      const bridgeConfig: StartConfig = {
        source: currentConfig?.source || 'mic',
        ...config,
      }
      await withRetry(() => connectAndLoadModel(bridgeConfig), '连接 Bridge')

      updateOverallState()
      return { success: true }
    } catch (e: any) {
      console.error(`[Orchestrator] 启动识别服务失败: ${e.message}`)
      return { success: false, error: e.message }
    }
  },

  async stopRecognitionOnly(): Promise<void> {
    broadcastProgress('stopping-bridge')
    transcriptionManager.disconnectBridge()

    completedSteps.delete('service')
    completedSteps.delete('bridge')
    completedSteps.delete('model')
    updateOverallState()
  },

  async switchSource(newSource: SourceType, streamUrl?: string): Promise<{ success: boolean; error?: string }> {
    if (state !== 'running') {
      return { success: false, error: '不在运行状态' }
    }

    try {
      if (transcriptionManager.hasStreamSource()) {
        transcriptionManager.stopStreamSource()
      }
      broadcast({ type: 'audio-source-stop', data: {} })

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
      broadcastStatus()

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

  async attemptRecovery(): Promise<void> {
    if (state !== 'running') return

    console.log('[Orchestrator] 检测到 Bridge 断开，开始自动恢复')
    state = 'starting'
    transcriptionManager.setManagerState('starting')

    if (transcriptionManager.hasStreamSource()) {
      transcriptionManager.stopStreamSource()
    }
    broadcast({ type: 'audio-source-stop', data: {} })

    try {
      broadcastProgress('bridge-connecting')
      await withRetry(() => connectAndLoadModel(currentConfig!), '重连 Bridge')

      if (currentConfig) {
        await startAudioSource(currentConfig)
      }

      state = 'running'
      transcriptionManager.setManagerState('running')
      console.log('[Orchestrator] 自动恢复成功')
    } catch (e: any) {
      console.error(`[Orchestrator] 自动恢复失败: ${e.message}`)
      try {
        completedSteps.delete('service')
        completedSteps.delete('bridge')
        completedSteps.delete('model')
        broadcastProgress('service-starting')
        await withRetry(launchService, '重启服务')
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
