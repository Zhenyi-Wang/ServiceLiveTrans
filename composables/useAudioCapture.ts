export interface AudioCaptureOptions {
  onAudioChunk: (base64Pcm: string) => void
  onError?: (error: string) => void
  deviceId?: string
  echoCancellation?: boolean
  noiseSuppression?: boolean
  targetSampleRate?: number
  chunkDurationMs?: number
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function useAudioCapture(options: AudioCaptureOptions) {
  const isCapturing = ref(false)
  const analyserNode = ref<AnalyserNode | null>(null)
  let audioContext: AudioContext | null = null
  let workletNode: AudioWorkletNode | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let stream: MediaStream | null = null

  const targetSampleRate = options.targetSampleRate ?? 16000
  const chunkDurationMs = options.chunkDurationMs ?? 100

  async function start() {
    if (isCapturing.value) return

    try {
      const constraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: options.echoCancellation ?? true,
        noiseSuppression: options.noiseSuppression ?? true
      }
      if (options.deviceId) {
        constraints.deviceId = { exact: options.deviceId }
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      audioContext = new AudioContext()
      await audioContext.audioWorklet.addModule('/audio-worklet-processor.js')

      sourceNode = audioContext.createMediaStreamSource(stream)
      const node = audioContext.createAnalyser()
      node.fftSize = 2048
      analyserNode.value = node

      workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')
      workletNode.port.postMessage({
        type: 'config',
        targetSampleRate,
        chunkDurationMs
      })

      sourceNode.connect(node)
      node.connect(workletNode)

      workletNode.port.onmessage = (event) => {
        const base64 = arrayBufferToBase64(event.data.pcm)
        options.onAudioChunk(base64)
      }

      isCapturing.value = true
    } catch (e: any) {
      options.onError?.(e.message || '麦克风访问失败')
      cleanup()
    }
  }

  function stop() {
    cleanup()
    isCapturing.value = false
  }

  function cleanup() {
    if (workletNode) {
      workletNode.disconnect()
      workletNode = null
    }
    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    if (analyserNode.value) {
      analyserNode.value.disconnect()
      analyserNode.value = null
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      stream = null
    }
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
  }

  onUnmounted(() => {
    cleanup()
  })

  return {
    isCapturing: readonly(isCapturing),
    analyserNode: readonly(analyserNode),
    start,
    stop
  }
}
