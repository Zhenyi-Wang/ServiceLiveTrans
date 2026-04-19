export interface AudioCaptureOptions {
  onAudioChunk: (base64Pcm: string) => void
  onError?: (error: string) => void
}

export function useAudioCapture(options: AudioCaptureOptions) {
  const isCapturing = ref(false)
  let audioContext: AudioContext | null = null
  let workletNode: AudioWorkletNode | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let stream: MediaStream | null = null

  async function start() {
    if (isCapturing.value) return

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      audioContext = new AudioContext({ sampleRate: 48000 })
      await audioContext.audioWorklet.addModule('/audio-worklet-processor.js')

      sourceNode = audioContext.createMediaStreamSource(stream)
      workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')

      workletNode.port.onmessage = (event) => {
        const bytes = new Uint8Array(event.data.pcm)
        const base64 = btoa(String.fromCharCode(...bytes))
        options.onAudioChunk(base64)
      }

      sourceNode.connect(workletNode)
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
    start,
    stop
  }
}
