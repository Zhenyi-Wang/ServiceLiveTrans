import type {
  WSMessage,
  WSInitData,
  TranscriptionStatusData,
  TranscriptionProgressData,
} from '~/types/websocket'
import type { ASRConfig } from '~/types/asr'

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
      case 'init': {
        const data = message.data as WSInitData
        if (data.transcriptionStatus) {
          const ts = data.transcriptionStatus
          state.value = ts.state
          audio.value = ts.audio
          recognition.value = ts.recognition
          error.value = ts.error
          if (ts.uptime > 0) {
            uptime.value = ts.uptime
            if (ts.state === 'running') startUptimeCounter()
          }
        }
        if (data.connectionCount !== undefined) {
          connectionCount.value = data.connectionCount
        }
        break
      }
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
        currentStep.value = data.step || null
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

  async function startTranscription(config: { source: string; streamUrl?: string } & ASRConfig) {
    try {
      await $fetch('/api/transcription/start', {
        method: 'POST',
        body: config,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '启动失败'
      const fetchErr =
        e && typeof e === 'object' && 'data' in e
          ? (e as { data?: { message?: string } }).data?.message
          : undefined
      error.value = fetchErr || msg
    }
  }

  async function stopTranscription() {
    try {
      await $fetch('/api/transcription/stop', { method: 'POST' })
    } catch (e: unknown) {
      console.error('停止失败:', e)
    }
  }

  async function startAudioOnly(config: { source: string; streamUrl?: string }) {
    try {
      await $fetch('/api/transcription/audio-start', {
        method: 'POST',
        body: config,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '启动音频源失败'
      const fetchErr =
        e && typeof e === 'object' && 'data' in e
          ? (e as { data?: { message?: string } }).data?.message
          : undefined
      error.value = fetchErr || msg
    }
  }

  async function stopAudioOnly() {
    try {
      await $fetch('/api/transcription/audio-stop', { method: 'POST' })
    } catch (e: unknown) {
      console.error('停止音频源失败:', e)
    }
  }

  async function startRecognitionOnly(config: ASRConfig) {
    try {
      await $fetch('/api/transcription/recognition-start', {
        method: 'POST',
        body: config,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '启动识别服务失败'
      const fetchErr =
        e && typeof e === 'object' && 'data' in e
          ? (e as { data?: { message?: string } }).data?.message
          : undefined
      error.value = fetchErr || msg
    }
  }

  async function stopRecognitionOnly() {
    try {
      await $fetch('/api/transcription/recognition-stop', { method: 'POST' })
    } catch (e: unknown) {
      console.error('停止识别服务失败:', e)
    }
  }

  async function switchSource(config: { source: string; streamUrl?: string }) {
    try {
      await $fetch('/api/transcription/switch-source', {
        method: 'POST',
        body: config,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '切换失败'
      const fetchErr =
        e && typeof e === 'object' && 'data' in e
          ? (e as { data?: { message?: string } }).data?.message
          : undefined
      error.value = fetchErr || msg
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
    startAudioOnly,
    stopAudioOnly,
    startRecognitionOnly,
    stopRecognitionOnly,
    switchSource,
  }
}
