# 浏览器音频源实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理后台 ASR 控制面板中支持浏览器麦克风和本地音频文件两种音频源，通过 WebSocket 传输到服务端 ASR 进行转录。

**Architecture:** 前端两种音频源（mic/file）都通过现有 WebSocket 通道发送 base64 PCM chunks 给服务端，服务端零改动。修改 AudioWorklet 支持可配置参数，新建文件播放和波形渲染 composable，重构 ASRControlPanel 面板。

**Tech Stack:** Vue 3 + TypeScript, Web Audio API (AudioWorklet, AudioContext, AnalyserNode), Canvas 2D, Nuxt 4 auto-imports

**注意：** 本项目没有 test/lint 命令。每个 Task 完成后手动验证（`pnpm dev` 启动后浏览器检查），最终用 Playwright 自动化测试。

---

### Task 1: 修改 AudioWorklet 支持可配置参数

**Files:**

- Modify: `public/audio-worklet-processor.js`

- [ ] **Step 1: 添加 port.onmessage 配置监听，支持运行时修改 targetSampleRate 和 chunkDurationMs**

将 `public/audio-worklet-processor.js` 替换为：

```javascript
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array()
    this._targetSampleRate = 16000
    this._outputChunkSize = 1600 // 100ms at 16kHz

    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        this._targetSampleRate = event.data.targetSampleRate
        this._outputChunkSize = Math.floor(
          (this._targetSampleRate * event.data.chunkDurationMs) / 1000,
        )
        this._buffer = new Float32Array()
      }
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const channel = input[0]
    this._buffer = Float32Array.from([...this._buffer, ...channel])

    const ratio = sampleRate / this._targetSampleRate
    const srcNeeded = Math.ceil(ratio * this._outputChunkSize)

    if (this._buffer.length < srcNeeded) return true

    const pcm16 = new Int16Array(this._outputChunkSize)
    for (let i = 0; i < this._outputChunkSize; i++) {
      const srcIndex = Math.floor(i * ratio)
      const sample = this._buffer[srcIndex] || 0
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
    }

    this._buffer = this._buffer.slice(srcNeeded)

    this.port.postMessage({ pcm: pcm16.buffer }, [pcm16.buffer])
    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
```

- [ ] **Step 2: 验证修改**

Run: `pnpm dev`，打开管理页面，用浏览器开发者工具确认 `public/audio-worklet-processor.js` 能正常加载（无报错）。

- [ ] **Step 3: Commit**

```bash
git add public/audio-worklet-processor.js
git commit -m "feat: AudioWorklet 支持运行时配置 targetSampleRate 和 chunkDurationMs"
```

---

### Task 2: 增强 useAudioCapture composable

**Files:**

- Modify: `composables/useAudioCapture.ts`

- [ ] **Step 1: 重写 useAudioCapture，支持 deviceId、可配降噪、返回 AnalyserNode**

将 `composables/useAudioCapture.ts` 替换为：

```typescript
export interface AudioCaptureOptions {
  onAudioChunk: (base64Pcm: string) => void
  onError?: (error: string) => void
  deviceId?: string
  echoCancellation?: boolean
  noiseSuppression?: boolean
  targetSampleRate?: number
  chunkDurationMs?: number
}

export function useAudioCapture(options: AudioCaptureOptions) {
  const isCapturing = ref(false)
  let audioContext: AudioContext | null = null
  let workletNode: AudioWorkletNode | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let analyserNode: AnalyserNode | null = null
  let stream: MediaStream | null = null

  const targetSampleRate = options.targetSampleRate ?? 16000
  const chunkDurationMs = options.chunkDurationMs ?? 100

  async function start() {
    if (isCapturing.value) return

    try {
      const constraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: options.echoCancellation ?? true,
        noiseSuppression: options.noiseSuppression ?? true,
      }
      if (options.deviceId) {
        constraints.deviceId = { exact: options.deviceId }
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      audioContext = new AudioContext()
      await audioContext.audioWorklet.addModule('/audio-worklet-processor.js')

      sourceNode = audioContext.createMediaStreamSource(stream)
      analyserNode = audioContext.createAnalyser()
      analyserNode.fftSize = 2048

      workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')
      workletNode.port.postMessage({
        type: 'config',
        targetSampleRate,
        chunkDurationMs,
      })

      sourceNode.connect(analyserNode)
      analyserNode.connect(workletNode)

      workletNode.port.onmessage = (event) => {
        const bytes = new Uint8Array(event.data.pcm)
        const base64 = btoa(String.fromCharCode(...bytes))
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
    if (analyserNode) {
      analyserNode.disconnect()
      analyserNode = null
    }
    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
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
    analyserNode: computed(() => analyserNode),
    start,
    stop,
  }
}
```

关键改动：

- `deviceId` 参数传入 `getUserMedia` 约束
- `echoCancellation`/`noiseSuppression` 可配
- `targetSampleRate`/`chunkDurationMs` 通过 AudioWorklet message 配置
- 音频图拓扑：`MediaStreamSource → AnalyserNode → AudioWorkletNode`
- 返回 `analyserNode` 用于波形可视化
- 移除 `sampleRate` 从 getUserMedia 约束（浏览器不遵守），使用浏览器默认采样率

- [ ] **Step 2: 验证**

Run: `pnpm dev`，打开管理页面。此 composable 目前还没有被调用方，确认 TypeScript 编译无报错即可。

- [ ] **Step 3: Commit**

```bash
git add composables/useAudioCapture.ts
git commit -m "feat: useAudioCapture 支持 deviceId、可配降噪、返回 AnalyserNode"
```

---

### Task 3: 创建 useAudioFilePlayer composable

**Files:**

- Create: `composables/useAudioFilePlayer.ts`

- [ ] **Step 1: 创建 useAudioFilePlayer**

创建 `composables/useAudioFilePlayer.ts`：

```typescript
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

export function useAudioFilePlayer(options: AudioFilePlayerOptions) {
  const isPlaying = ref(false)
  const isPaused = ref(false)
  const currentTime = ref(0)
  const audioBuffer = ref<AudioBuffer | null>(null)
  const fileInfo = ref<AudioFileInfo | null>(null)
  const waveformPeaks = ref<Float32Array | null>(null)

  let audioContext: AudioContext | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null
  let currentChunkIndex = 0

  const targetSampleRate = options.targetSampleRate ?? 16000
  const chunkDurationMs = options.chunkDurationMs ?? 100
  const chunkSampleCount = Math.floor((targetSampleRate * chunkDurationMs) / 1000)

  async function loadFile(file: File) {
    try {
      stop()

      const arrayBuffer = await file.arrayBuffer()
      audioContext = new AudioContext()
      const buffer = await audioContext.decodeAudioData(arrayBuffer)

      audioBuffer.value = buffer
      fileInfo.value = {
        name: file.name,
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        numberOfChannels: buffer.numberOfChannels,
      }
      currentTime.value = 0
      currentChunkIndex = 0

      waveformPeaks.value = generateWaveformPeaks(buffer, 200)
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
    if (wasPlaying) {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
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
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
    audioBuffer.value = null
    fileInfo.value = null
    waveformPeaks.value = null
  }

  function sendCurrentChunk() {
    if (!audioBuffer.value) return

    const startTime = currentChunkIndex * (chunkDurationMs / 1000)
    const endTime = startTime + chunkDurationMs / 1000

    if (endTime > audioBuffer.value.duration) {
      stop()
      options.onEnded?.()
      return
    }

    const startSample = Math.floor(startTime * audioBuffer.value.sampleRate)
    const endSample = Math.min(
      Math.floor(endTime * audioBuffer.value.sampleRate),
      audioBuffer.value.length,
    )
    const sourceChannel = audioBuffer.value.getChannelData(0)

    const pcm16 = new Int16Array(chunkSampleCount)
    const ratio = audioBuffer.value.sampleRate / targetSampleRate

    for (let i = 0; i < chunkSampleCount; i++) {
      const srcIndex = Math.min(startSample + Math.floor(i * ratio), endSample - 1)
      const sample = srcIndex >= 0 ? sourceChannel[srcIndex] : 0
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
    }

    const bytes = new Uint8Array(pcm16.buffer)
    const base64 = btoa(String.fromCharCode(...bytes))
    options.onAudioChunk(base64)

    currentTime.value = endTime
    currentChunkIndex++
  }

  function sendSilentChunk() {
    const pcm16 = new Int16Array(chunkSampleCount)
    const bytes = new Uint8Array(pcm16.buffer)
    const base64 = btoa(String.fromCharCode(...bytes))
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
    loadFile,
    play,
    pause,
    seek,
    stop,
    destroy,
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `pnpm dev`，确认无编译错误。

- [ ] **Step 3: Commit**

```bash
git add composables/useAudioFilePlayer.ts
git commit -m "feat: 创建 useAudioFilePlayer composable 支持文件解码、切片发送和 seek"
```

---

### Task 4: 创建 useWaveformRenderer composable

**Files:**

- Create: `composables/useWaveformRenderer.ts`

- [ ] **Step 1: 创建 useWaveformRenderer**

创建 `composables/useWaveformRenderer.ts`：

```typescript
export interface WaveformRendererOptions {
  color?: string
  backgroundColor?: string
  height?: number
}

export function useWaveformRenderer(
  canvasRef: Ref<HTMLCanvasElement | null>,
  options: WaveformRendererOptions = {},
) {
  const color = options.color ?? '#38bdf8'
  const bgColor = options.backgroundColor ?? 'rgba(0, 0, 0, 0.2)'
  const height = options.height ?? 60

  let animFrameId: number | null = null

  function drawRealtimeWaveform(analyserNode: AnalyserNode | null) {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.height = height
    const width = canvas.clientWidth
    canvas.width = width

    function draw() {
      if (!analyserNode || !canvas) return

      const bufferLength = analyserNode.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      analyserNode.getByteTimeDomainData(dataArray)

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)

      ctx.lineWidth = 1.5
      ctx.strokeStyle = color
      ctx.beginPath()

      const sliceWidth = width / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * height) / 2

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
        x += sliceWidth
      }

      ctx.lineTo(width, height / 2)
      ctx.stroke()

      animFrameId = requestAnimationFrame(draw)
    }

    draw()
  }

  function drawStaticWaveform(peaks: Float32Array, progress?: number) {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.height = height
    const width = canvas.clientWidth
    canvas.width = width

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)

    const barWidth = width / peaks.length
    const halfHeight = height / 2

    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * halfHeight
      const x = i * barWidth

      ctx.fillStyle = color
      ctx.globalAlpha = 0.7
      ctx.fillRect(x, halfHeight - barHeight, Math.max(barWidth - 1, 1), barHeight * 2)
    }

    ctx.globalAlpha = 1.0

    if (progress !== undefined && progress > 0) {
      const progressX = Math.min(progress * width, width)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(progressX, 0)
      ctx.lineTo(progressX, height)
      ctx.stroke()
    }
  }

  function drawIdle() {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.height = height
    const width = canvas.clientWidth
    canvas.width = width

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
  }

  function stopAnimation() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  onUnmounted(() => {
    stopAnimation()
  })

  return {
    drawRealtimeWaveform,
    drawStaticWaveform,
    drawIdle,
    stopAnimation,
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

- [ ] **Step 3: Commit**

```bash
git add composables/useWaveformRenderer.ts
git commit -m "feat: 创建 useWaveformRenderer composable 支持实时和静态波形绘制"
```

---

### Task 5: 重构 ASRControlPanel — 移除 stream 选项，添加 mic/file 双源 UI

**Files:**

- Modify: `components/admin/ASRControlPanel.vue`
- Modify: `pages/admin.vue`

这是最大的改动。分步进行。

- [ ] **Step 1: 重写 ASRControlPanel.vue 的 script 部分**

`components/admin/ASRControlPanel.vue` 完整替换为以下内容（script + template + style）：

```vue
<script setup lang="ts">
const props = defineProps<{
  isRunning: boolean
  isLoading: boolean
  wsSend: (data: { type: string; data: string }) => boolean
}>()

const emit = defineEmits<{
  start: [config: { provider: string; model: string; source: string }]
  stop: []
}>()

const source = ref<'mic' | 'file'>('mic')
const provider = ref('whisper')
const availableProviders = ['whisper', 'funasr']

// 麦克风相关
const devices = ref<MediaDeviceInfo[]>([])
const selectedDeviceId = ref<string>('')
const micError = ref('')

// 文件相关
const fileInput = ref<HTMLInputElement | null>(null)
const filePlayer = useAudioFilePlayer({
  onAudioChunk: (base64Pcm) => {
    props.wsSend({ type: 'audio', data: base64Pcm })
  },
  onError: (msg) => {
    micError.value = msg
  },
  onEnded: () => {
    micError.value = '文件播放完毕'
  },
})

// 波形
const micCanvasRef = ref<HTMLCanvasElement | null>(null)
const fileCanvasRef = ref<HTMLCanvasElement | null>(null)
const micWaveform = useWaveformRenderer(micCanvasRef)
const fileWaveform = useWaveformRenderer(fileCanvasRef)

// 高级设置
const showAdvanced = ref(false)
const advancedSettings = ref({
  targetSampleRate: 16000,
  chunkDurationMs: 100,
  echoCancellation: true,
  noiseSuppression: true,
})

// 麦克风捕获
let audioCapture: ReturnType<typeof useAudioCapture> | null = null

// 枚举设备
async function enumerateDevices() {
  try {
    const allDevices = await navigator.mediaDevices.enumerateDevices()
    devices.value = allDevices.filter((d) => d.kind === 'audioinput')
    if (devices.value.length > 0 && !selectedDeviceId.value) {
      selectedDeviceId.value = devices.value[0].deviceId
    }
  } catch {
    // 非 HTTPS 环境可能无法枚举
  }
}

function handleDeviceChange() {
  enumerateDevices()
}

// 文件选择
function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    filePlayer.loadFile(file)
  }
}

function triggerFileInput() {
  fileInput.value?.click()
}

// 进度条交互
function handleSeek(event: Event) {
  const input = event.target as HTMLInputElement
  const time = parseFloat(input.value)
  filePlayer.seek(time)
}

// 格式化时间
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 启动/停止
function handleStart() {
  micError.value = ''
  emit('start', {
    provider: provider.value,
    model: '',
    source: 'mic',
  })
}

function handleStartSuccess() {
  if (source.value === 'mic') {
    startMicCapture()
  } else {
    startFilePlayback()
  }
}

function startMicCapture() {
  audioCapture = useAudioCapture({
    deviceId: selectedDeviceId.value || undefined,
    echoCancellation: advancedSettings.value.echoCancellation,
    noiseSuppression: advancedSettings.value.noiseSuppression,
    targetSampleRate: advancedSettings.value.targetSampleRate,
    chunkDurationMs: advancedSettings.value.chunkDurationMs,
    onAudioChunk: (base64Pcm) => {
      props.wsSend({ type: 'audio', data: base64Pcm })
    },
    onError: (msg) => {
      micError.value = msg
    },
  })
  audioCapture.start()
  nextTick(() => {
    micWaveform.drawRealtimeWaveform(audioCapture.analyserNode.value ?? null)
  })
}

function startFilePlayback() {
  if (!filePlayer.audioBuffer.value) {
    micError.value = '请先选择音频文件'
    return
  }
  filePlayer.play()
}

function handleStopClick() {
  stopCapture()
  emit('stop')
}

function stopCapture() {
  micWaveform.stopAnimation()
  fileWaveform.stopAnimation()
  if (audioCapture) {
    audioCapture.stop()
    audioCapture = null
  }
  filePlayer.stop()
}

// 暴露方法供 admin.vue 调用
defineExpose({
  handleStartSuccess,
  stopCapture,
})

// 监听文件波形进度
watch(
  () => filePlayer.currentTime.value,
  (time) => {
    if (filePlayer.waveformPeaks.value && filePlayer.audioBuffer.value) {
      const progress = time / filePlayer.audioBuffer.value.duration
      fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, progress)
    }
  },
)

// 监听源切换，绘制 idle 波形
watch(source, (val) => {
  micError.value = ''
  nextTick(() => {
    if (val === 'mic') {
      micWaveform.drawIdle()
    } else {
      if (filePlayer.waveformPeaks.value) {
        fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, 0)
      } else {
        fileWaveform.drawIdle()
      }
    }
  })
})

// 监听文件加载完成
watch(
  () => filePlayer.waveformPeaks.value,
  (peaks) => {
    if (peaks && source.value === 'file') {
      nextTick(() => {
        fileWaveform.drawStaticWaveform(peaks, 0)
      })
    }
  },
)

onMounted(() => {
  enumerateDevices()
  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
  nextTick(() => {
    micWaveform.drawIdle()
  })
})

onUnmounted(() => {
  navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  stopCapture()
  filePlayer.destroy()
})
</script>
```

- [ ] **Step 2: 重写 ASRControlPanel.vue 的 template 部分**

在 `</script>` 标签后添加 template：

```vue
<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </div>
      <span class="panel-title">ASR CONTROL</span>
      <span v-if="isRunning" class="status-badge active">LIVE</span>
    </div>

    <div class="panel-content">
      <!-- Provider -->
      <div class="form-row">
        <label class="form-label">PROVIDER</label>
        <div class="provider-grid">
          <button
            v-for="p in availableProviders"
            :key="p"
            class="provider-btn"
            :class="{ active: provider === p }"
            :disabled="isRunning"
            @click="provider = p"
          >
            {{ p }}
          </button>
        </div>
      </div>

      <!-- Source -->
      <div class="form-row">
        <label class="form-label">SOURCE</label>
        <div class="source-grid">
          <button
            class="source-btn"
            :class="{ active: source === 'mic' }"
            :disabled="isRunning"
            @click="source = 'mic'"
          >
            Microphone
          </button>
          <button
            class="source-btn"
            :class="{ active: source === 'file' }"
            :disabled="isRunning"
            @click="source = 'file'"
          >
            File
          </button>
        </div>
      </div>

      <!-- Mic: Device Selection -->
      <div v-if="source === 'mic'" class="form-row">
        <label class="form-label">DEVICE</label>
        <select v-model="selectedDeviceId" class="form-input" :disabled="isRunning">
          <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">
            {{ d.label || `设备 ${devices.indexOf(d) + 1}` }}
          </option>
        </select>
      </div>

      <!-- Mic: Waveform -->
      <div v-if="source === 'mic'" class="form-row">
        <label class="form-label">WAVEFORM</label>
        <div class="waveform-container">
          <canvas ref="micCanvasRef" class="waveform-canvas" />
        </div>
      </div>

      <!-- File: File Selection -->
      <div v-if="source === 'file'" class="form-row">
        <label class="form-label">AUDIO FILE</label>
        <div class="file-select-row">
          <button class="file-select-btn" :disabled="isRunning" @click="triggerFileInput">
            {{ filePlayer.fileInfo.value ? filePlayer.fileInfo.value.name : '选择文件...' }}
          </button>
          <span v-if="filePlayer.fileInfo.value" class="file-duration">
            {{ formatTime(filePlayer.fileInfo.value.duration) }}
          </span>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="audio/*"
          class="hidden"
          @change="handleFileSelect"
        />
      </div>

      <!-- File: Progress Bar -->
      <div v-if="source === 'file' && filePlayer.fileInfo.value" class="form-row">
        <label class="form-label">
          PROGRESS
          <span class="progress-time">
            {{ formatTime(filePlayer.currentTime.value) }} /
            {{ formatTime(filePlayer.fileInfo.value.duration) }}
          </span>
        </label>
        <input
          type="range"
          :min="0"
          :max="filePlayer.fileInfo.value.duration"
          :step="0.01"
          :value="filePlayer.currentTime.value"
          class="progress-bar"
          :disabled="isRunning"
          @input="handleSeek"
        />
        <div class="file-controls">
          <button
            v-if="!filePlayer.isPlaying.value && !isRunning"
            class="ctrl-btn"
            @click="filePlayer.play()"
          >
            PLAY
          </button>
          <button
            v-if="filePlayer.isPlaying.value && !isRunning"
            class="ctrl-btn"
            @click="filePlayer.pause()"
          >
            PAUSE
          </button>
        </div>
      </div>

      <!-- File: Waveform -->
      <div v-if="source === 'file'" class="form-row">
        <label class="form-label">WAVEFORM</label>
        <div class="waveform-container" @click="handleWaveformClick">
          <canvas ref="fileCanvasRef" class="waveform-canvas" />
        </div>
      </div>

      <!-- Error -->
      <div v-if="micError" class="error-message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{{ micError }}</span>
      </div>

      <!-- Advanced Settings -->
      <div class="form-row">
        <button class="advanced-toggle" @click="showAdvanced = !showAdvanced">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="toggle-icon"
            :class="{ rotated: showAdvanced }"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          ADVANCED SETTINGS
        </button>
      </div>

      <div v-if="showAdvanced" class="advanced-settings">
        <div class="form-row">
          <label class="form-label">OUTPUT SAMPLE RATE (Hz)</label>
          <select
            v-model.number="advancedSettings.targetSampleRate"
            class="form-input"
            :disabled="isRunning"
          >
            <option :value="8000">8000</option>
            <option :value="16000">16000</option>
            <option :value="48000">48000</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">CHUNK SIZE (ms)</label>
          <select
            v-model.number="advancedSettings.chunkDurationMs"
            class="form-input"
            :disabled="isRunning"
          >
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </div>
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input
              type="checkbox"
              v-model="advancedSettings.echoCancellation"
              :disabled="isRunning"
            />
            <span>ECHO CANCELLATION</span>
          </label>
        </div>
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input
              type="checkbox"
              v-model="advancedSettings.noiseSuppression"
              :disabled="isRunning"
            />
            <span>NOISE SUPPRESSION</span>
          </label>
        </div>
      </div>

      <!-- Actions -->
      <div class="action-row">
        <button
          v-if="!isRunning"
          class="action-btn start"
          :disabled="isLoading || (source === 'file' && !filePlayer.fileInfo.value)"
          @click="handleStart"
        >
          START ASR
        </button>
        <button v-else class="action-btn stop" :disabled="isLoading" @click="handleStopClick">
          STOP ASR
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: 添加 ASRControlPanel.vue 的 style 部分**

在 `</template>` 标签后添加 style（保留现有样式，添加新的样式）：

```vue
<style scoped>
.panel {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
}

.panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.5), transparent);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.panel-icon {
  width: 36px;
  height: 36px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
}

.panel-icon svg {
  width: 20px;
  height: 20px;
}

.panel-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.status-badge {
  margin-left: auto;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.status-badge.active {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid rgba(16, 185, 129, 0.5);
  color: #10b981;
  animation: pulse 1.5s ease-in-out infinite;
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.7);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.provider-grid,
.source-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.provider-btn,
.source-btn {
  padding: 0.6rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: 8px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.provider-btn:hover:not(:disabled),
.source-btn:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
}

.provider-btn.active,
.source-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

.provider-btn:disabled,
.source-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form-input {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  transition: all 0.3s ease;
  width: 100%;
}

.form-input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1);
}

.form-input::placeholder {
  color: rgba(148, 163, 184, 0.4);
}

.form-input:disabled {
  opacity: 0.5;
}

/* File select */
.file-select-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.file-select-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 8px;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all 0.3s ease;
}

.file-select-btn:hover:not(:disabled) {
  border-color: rgba(56, 189, 248, 0.4);
}

.file-select-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-duration {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: #38bdf8;
  white-space: nowrap;
}

.hidden {
  display: none;
}

/* Progress bar */
.progress-time {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  color: rgba(56, 189, 248, 0.7);
}

.progress-bar {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.progress-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #38bdf8;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
}

.progress-bar:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress-bar:disabled::-webkit-slider-thumb {
  cursor: not-allowed;
}

.file-controls {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.ctrl-btn {
  padding: 0.4rem 0.8rem;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 6px;
  color: #38bdf8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ctrl-btn:hover {
  background: rgba(56, 189, 248, 0.2);
}

/* Waveform */
.waveform-container {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(56, 189, 248, 0.15);
}

.waveform-canvas {
  width: 100%;
  display: block;
}

/* Error message */
.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #f87171;
  font-size: 0.75rem;
}

.error-message svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Advanced settings */
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: rgba(148, 163, 184, 0.6);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s;
}

.advanced-toggle:hover {
  color: #94a3b8;
}

.toggle-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.2s;
}

.toggle-icon.rotated {
  transform: rotate(180deg);
}

.advanced-settings {
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.1);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.advanced-check-row {
  flex-direction: row;
}

.check-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.check-label input[type='checkbox'] {
  accent-color: #38bdf8;
}

.check-label span {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: #94a3b8;
  letter-spacing: 0.1em;
}

/* Action buttons */
.action-row {
  margin-top: 0.5rem;
}

.action-btn {
  width: 100%;
  padding: 0.75rem;
  border-radius: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid;
}

.action-btn.start {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1));
  border-color: rgba(16, 185, 129, 0.4);
  color: #10b981;
}

.action-btn.start:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.2));
  border-color: rgba(16, 185, 129, 0.6);
}

.action-btn.stop {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1));
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

.action-btn.stop:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.2));
  border-color: rgba(239, 68, 68, 0.6);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>
```

- [ ] **Step 4: 修改 admin.vue — 传递 wsSend prop，调整 ASR 启动逻辑**

在 `pages/admin.vue` 中做以下修改：

1. 在 `<script setup>` 中找到 `handleASRStart` 函数，修改为：

```typescript
const handleASRStart = async (config: { provider: string; model: string; source: string }) => {
  asrIsLoading.value = true
  try {
    await $fetch('/api/asr/start', {
      method: 'POST',
      body: config,
    })
    asrIsRunning.value = true
    await fetchStatus()
    // 通知面板 ASR 启动成功，可以开始捕获
    asrPanelRef.value?.handleStartSuccess()
  } catch (error: any) {
    const msg = error?.data?.message || error.message || '启动失败'
    console.error('Failed to start ASR:', msg)
  } finally {
    asrIsLoading.value = false
  }
}
```

2. 添加 `asrPanelRef`：

```typescript
const asrPanelRef = ref<InstanceType<typeof AdminASRControlPanel> | null>(null)
```

3. 获取 `useWebSocket` 的 `send` 方法（admin 页面需要 WS 连接来发送音频）：

在 `<script setup>` 中添加：

```typescript
const { send: wsSend } = useWebSocket({
  onMessage: (msg) => {
    // admin 页面可能也需要接收 WS 消息（状态更新等）
  },
})
```

4. 在模板中给 `AdminASRControlPanel` 添加 ref 和 wsSend prop：

```vue
<AdminASRControlPanel
  ref="asrPanelRef"
  :is-running="asrIsRunning"
  :is-loading="asrIsLoading"
  :ws-send="wsSend"
  @start="handleASRStart"
  @stop="handleASRStop"
/>
```

5. 修改 `handleASRStop`，先停止捕获再停 ASR：

```typescript
const handleASRStop = async () => {
  asrIsLoading.value = true
  try {
    asrPanelRef.value?.stopCapture()
    await $fetch('/api/asr/stop', { method: 'POST' })
    asrIsRunning.value = false
    await fetchStatus()
  } catch (error) {
    console.error('Failed to stop ASR:', error)
  } finally {
    asrIsLoading.value = false
  }
}
```

- [ ] **Step 5: 验证**

Run: `pnpm dev`，打开 `http://localhost:3000/admin`，确认：

- ASRControlPanel 显示 Microphone / File 两个源按钮（无 Stream URL）
- 选择 Mic 时显示设备下拉和波形区域
- 选择 File 时显示文件选择按钮和波形区域
- 高级设置折叠区域可展开/收起
- TypeScript 无编译错误

- [ ] **Step 6: Commit**

```bash
git add components/admin/ASRControlPanel.vue pages/admin.vue
git commit -m "feat: 重构 ASRControlPanel 支持 mic/file 双源、设备枚举、波形和高级设置"
```

---

### Task 6: Playwright 集成测试 — 文件源端到端

**Files:**

- 无新文件

- [ ] **Step 1: 启动开发服务器和 Edge 浏览器**

启动 dev server：

```bash
pnpm dev
```

启动 Edge with remote debugging：

```bash
powershell.exe -Command 'Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList "--remote-debugging-port=9222","--remote-allow-origins=*","--user-data-dir=C:\ChromeMCP\9222"'
```

- [ ] **Step 2: 用 Playwright 打开管理页面，选择 File 源，加载测试音频**

测试音频文件路径（桌面上找到的小 m4a 文件）：

```
D:\OneDrive\Desktop_home\讲道音频存档\已发送讲道\2022-03-15\原始录音\20230306_201123.m4a
```

用 Playwright：

1. 导航到 `http://localhost:3000/admin`
2. 点击 File 按钮
3. 上传音频文件
4. 确认文件名和时长显示
5. 确认静态波形绘制

- [ ] **Step 3: 验证进度条交互**

1. 确认进度条范围和步长正确
2. 拖拽进度条确认时间更新
3. 确认波形播放指针位置更新

- [ ] **Step 4: 验证高级设置**

1. 展开高级设置
2. 确认 OUTPUT SAMPLE RATE 下拉有 8000/16000/48000 选项
3. 确认 CHUNK SIZE 下拉有 50/100/200 选项
4. 选择 Mic 源时确认 ECHO CANCEL / NOISE SUPPRESS 复选框可见
5. 选择 File 源时确认这两个复选框隐藏

- [ ] **Step 5: 验证 START/STOP 按钮状态**

1. 未选择文件时 START 按钮应禁用
2. 选择文件后 START 按钮应启用
3. 点击 START 后按钮变为 STOP

- [ ] **Step 6: Commit（如有修复）**

如果有 bug 修复，提交修复。

---

### Task 7: 最终 Playwright 测试 — 完整文件播放流程（从中间开始）

**Files:**

- 无新文件

- [ ] **Step 1: 选择一个较大的讲道 mp3 文件测试**

从桌面找到的文件中选择一个（如 ~100MB 的 mp3），通过 Playwright 加载。

- [ ] **Step 2: 验证 seek 到中间位置**

1. 加载文件后，seek 到文件中间位置（50%）
2. 点击 START ASR
3. 确认音频开始从中间位置播放
4. 观察进度条前进
5. 观察波形指针移动

- [ ] **Step 3: 验证暂停/继续**

1. 暂停播放
2. 确认进度条停止
3. 继续播放
4. 确认进度条恢复前进

- [ ] **Step 4: 验证 STOP**

1. 点击 STOP ASR
2. 确认音频停止
3. 确认进度重置
4. 确认可以重新 seek 和播放

- [ ] **Step 5: 最终 Commit（如有修复）**

如果有 bug 修复，提交修复。
