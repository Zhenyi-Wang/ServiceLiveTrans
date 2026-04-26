export interface AudioFilePlayerOptions {
  onAudioChunk: (base64Pcm: string) => void
  onError?: (error: string) => void
  onEnded?: () => void
  targetSampleRate?: number
  chunkDurationMs?: number
}

export interface AudioFileInfo {
  name: string
  duration: number
  sampleRate: number
  numberOfChannels: number
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function useAudioFilePlayer(options: AudioFilePlayerOptions) {
  const isPlaying = ref(false)
  const isPaused = ref(false)
  const currentTime = ref(0)
  const audioBuffer = ref<AudioBuffer | null>(null)
  const fileInfo = ref<AudioFileInfo | null>(null)
  const waveformPeaks = ref<Float32Array | null>(null)
  const volume = ref(1.0)

  let intervalId: ReturnType<typeof setInterval> | null = null
  let currentChunkIndex = 0

  const targetSampleRate = options.targetSampleRate ?? 16000
  const chunkDurationMs = options.chunkDurationMs ?? 100
  const chunkSampleCount = Math.floor(targetSampleRate * chunkDurationMs / 1000)

  async function loadFile(file: File) {
    try {
      stop()

      const arrayBuffer = await file.arrayBuffer()
      const ctx = new AudioContext()
      try {
        const buffer = await ctx.decodeAudioData(arrayBuffer)
        audioBuffer.value = buffer
        fileInfo.value = {
          name: file.name,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
          numberOfChannels: buffer.numberOfChannels
        }
        currentTime.value = 0
        currentChunkIndex = 0
        waveformPeaks.value = generateWaveformPeaks(buffer, 200)
      } finally {
        ctx.close()
      }
    } catch (e: any) {
      options.onError?.(e.message || '音频文件解码失败')
    }
  }

  function play(startOffset?: number) {
    if (!audioBuffer.value) return
    if (audioBuffer.value.duration === 0) return

    if (startOffset !== undefined) {
      currentTime.value = startOffset
      currentChunkIndex = Math.floor(startOffset / (chunkDurationMs / 1000))
    }

    isPlaying.value = true
    isPaused.value = false

    intervalId = setInterval(() => {
      sendCurrentChunk()
    }, chunkDurationMs)
  }

  function pause() {
    isPaused.value = true
    isPlaying.value = false
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  function seek(time: number) {
    const wasPlaying = isPlaying.value
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }

    currentTime.value = Math.max(0, Math.min(time, audioBuffer.value?.duration ?? 0))
    currentChunkIndex = Math.floor(currentTime.value / (chunkDurationMs / 1000))

    if (wasPlaying) {
      sendSilentChunk()
      intervalId = setInterval(() => {
        sendCurrentChunk()
      }, chunkDurationMs)
    }
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    isPlaying.value = false
    isPaused.value = false
    currentTime.value = 0
    currentChunkIndex = 0
  }

  function destroy() {
    stop()
    audioBuffer.value = null
    fileInfo.value = null
    waveformPeaks.value = null
  }

  function sendCurrentChunk() {
    if (!audioBuffer.value) return

    const startTime = currentChunkIndex * (chunkDurationMs / 1000)
    const endTime = startTime + (chunkDurationMs / 1000)

    if (endTime > audioBuffer.value.duration) {
      stop()
      options.onEnded?.()
      return
    }

    const startSample = Math.floor(startTime * audioBuffer.value.sampleRate)
    const endSample = Math.min(Math.floor(endTime * audioBuffer.value.sampleRate), audioBuffer.value.length)
    const sourceChannel = audioBuffer.value.getChannelData(0)

    const pcm16 = new Int16Array(chunkSampleCount)
    const ratio = audioBuffer.value.sampleRate / targetSampleRate

    for (let i = 0; i < chunkSampleCount; i++) {
      const srcIndex = Math.min(startSample + Math.floor(i * ratio), endSample - 1)
      const sample = srcIndex >= 0 ? sourceChannel[srcIndex] : 0
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * volume.value * 32767)))
    }

    const base64 = arrayBufferToBase64(pcm16.buffer)
    options.onAudioChunk(base64)

    currentTime.value = endTime
    currentChunkIndex++
  }

  function sendSilentChunk() {
    const pcm16 = new Int16Array(chunkSampleCount)
    const base64 = arrayBufferToBase64(pcm16.buffer)
    options.onAudioChunk(base64)
  }

  function generateWaveformPeaks(buffer: AudioBuffer, targetBins: number): Float32Array {
    const channel = buffer.getChannelData(0)
    const samplesPerBin = Math.floor(channel.length / targetBins)
    const peaks = new Float32Array(targetBins)

    for (let i = 0; i < targetBins; i++) {
      let max = 0
      const start = i * samplesPerBin
      const end = Math.min(start + samplesPerBin, channel.length)
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channel[j])
        if (abs > max) max = abs
      }
      peaks[i] = max
    }

    return peaks
  }

  onUnmounted(() => {
    destroy()
  })

  return {
    isPlaying: readonly(isPlaying),
    isPaused: readonly(isPaused),
    currentTime: readonly(currentTime),
    audioBuffer: readonly(audioBuffer),
    fileInfo: readonly(fileInfo),
    waveformPeaks: readonly(waveformPeaks),
    volume,
    loadFile,
    play,
    pause,
    seek,
    stop,
    destroy
  }
}
