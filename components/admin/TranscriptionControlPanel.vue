<script setup lang="ts">
import type { WSMessage, AudioSourceCommandData } from '~/types/websocket'

const props = defineProps<{
  connectionCount: number
  subtitleCount: number
}>()

const emit = defineEmits<{
  'status-change': [state: string]
  'counts-update': [connectionCount: number, subtitleCount: number]
}>()

// ─── Composables ───────────────────────────────────────────
const transcription = useTranscription()

const { send: wsSend } = useWebSocket({
  onMessage: (msg: WSMessage) => {
    // 处理音频源启停指令
    if (msg.type === 'audio-source-start') {
      const data = msg.data as AudioSourceCommandData
      if (data.source === 'mic') {
        startMicCapture()
      } else if (data.source === 'file') {
        startFilePlayback()
      }
    } else if (msg.type === 'audio-source-stop') {
      stopCapture()
    }
    // 处理转录状态消息
    transcription.handleWSMessage(msg)
  }
})

// ─── Audio source ──────────────────────────────────────────
const source = ref<'mic' | 'file' | 'stream'>('mic')
const DEFAULT_STREAM_URL = 'http://mini:8080/live/livestream.flv'
const streamUrl = ref('')

const devices = ref<MediaDeviceInfo[]>([])
const devicesReady = ref<'loading' | 'ready' | 'empty'>('loading')
const selectedDeviceId = ref<string>('')
const statusMessage = ref('')
const statusType = ref<'error' | 'info'>('error')

const fileInput = ref<HTMLInputElement | null>(null)
const filePlayer = useAudioFilePlayer({
  onAudioChunk: (base64Pcm) => {
    wsSend({ type: 'audio', data: base64Pcm })
  },
  onError: (msg) => { setStatus(msg, 'error') },
  onEnded: () => { setStatus('文件播放完毕', 'info') }
})

const micCanvasRef = ref<HTMLCanvasElement | null>(null)
const fileCanvasRef = ref<HTMLCanvasElement | null>(null)
const micWaveform = useWaveformRenderer(micCanvasRef)
const fileWaveform = useWaveformRenderer(fileCanvasRef)

const showAdvanced = ref(false)

const micVolume = useLocalStorage('asr-mic-volume', 5)
const fileVolume = useLocalStorage('asr-file-volume', 5)

// ─── Advanced settings ─────────────────────────────────────
const advancedSettings = ref({
  targetSampleRate: 16000,
  chunkDurationMs: 100,
  echoCancellation: true,
  noiseSuppression: true,
  overlapSec: 0.1,
  memoryChunks: 2
})

const provider = ref('gguf')

const serviceHealth = ref<{
  status: 'ok' | 'offline'
  available_providers?: string[]
}>({ status: 'offline' })

const serviceLoading = ref(false)

const availableProviders = computed(() => {
  return serviceHealth.value.available_providers?.length
    ? serviceHealth.value.available_providers!
    : ['gguf']
})

watch(availableProviders, (providers) => {
  if (providers.length > 0 && !providers.includes(provider.value)) {
    provider.value = providers[0]
  }
}, { immediate: true })

// ─── Helpers ───────────────────────────────────────────────
function sliderToGain(s: number): number {
  if (s <= 0) return 0
  if (s <= 5) return Math.pow(10, (s / 5 - 1) * 3)
  return 1 + (s - 5) / 5 * 9
}

function gainToPercent(s: number): string {
  return Math.round(sliderToGain(s) * 100) + '%'
}

function setStatus(msg: string, type: 'error' | 'info') {
  statusMessage.value = msg
  statusType.value = type
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── Step labels ───────────────────────────────────────────
const stepLabels: Record<string, string> = {
  'health-checking': '检查服务...',
  'health-ok': '服务就绪',
  'service-starting': '启动识别服务...',
  'service-ready': '服务已启动',
  'bridge-connecting': '连接识别引擎...',
  'bridge-connected': '引擎已连接',
  'model-loading': '加载模型...',
  'model-ready': '模型就绪',
  'source-starting': '启动音频源...',
  'source-ready': '音频源就绪',
  'stopping-source': '停止音频源...',
  'stopping-bridge': '断开引擎...',
  'stopping-service': '停止服务...'
}

// ─── State derived ─────────────────────────────────────────
const stateLabel = computed(() => {
  const s = transcription.state.value
  if (s === 'idle') return '空闲'
  if (s === 'starting') return '启动中'
  if (s === 'running') return '转录中'
  if (s === 'stopping') return '停止中'
  if (s === 'error') return '错误'
  return s
})

const stateColor = computed(() => {
  const s = transcription.state.value
  if (s === 'idle') return '#94a3b8'
  if (s === 'starting') return '#fbbf24'
  if (s === 'running') return '#22d3ee'
  if (s === 'stopping') return '#fbbf24'
  if (s === 'error') return '#f87171'
  return '#94a3b8'
})

const stateClass = computed(() => ({
  'state-idle': transcription.state.value === 'idle',
  'state-starting': transcription.state.value === 'starting',
  'state-running': transcription.state.value === 'running',
  'state-stopping': transcription.state.value === 'stopping',
  'state-error': transcription.state.value === 'error',
}))

const canStart = computed(() => {
  const s = transcription.state.value
  return s === 'idle' || s === 'error'
})

const canStop = computed(() => {
  return transcription.state.value === 'running'
})

const isTransitioning = computed(() => {
  const s = transcription.state.value
  return s === 'starting' || s === 'stopping'
})

// ─── Device enumeration ────────────────────────────────────
async function enumerateDevices() {
  devicesReady.value = 'loading'
  try {
    const allDevices = await navigator.mediaDevices.enumerateDevices()
    devices.value = allDevices.filter(d => d.kind === 'audioinput')
    devicesReady.value = devices.value.length > 0 ? 'ready' : 'empty'
    if (devices.value.length > 0 && !selectedDeviceId.value) {
      selectedDeviceId.value = devices.value[0].deviceId
    }
  } catch {
    devicesReady.value = 'empty'
    setStatus('需要 HTTPS 或 localhost 环境才能访问麦克风', 'error')
  }
}

function handleDeviceChange() {
  enumerateDevices()
}

// ─── Audio capture (mic) ───────────────────────────────────
const isMicMonitoring = ref(false)
const micVolumeWatcher = ref<WatchStopHandle | null>(null)
const audioCapture = shallowRef<ReturnType<typeof useAudioCapture> | null>(null)

async function startMicCapture() {
  if (isMicMonitoring.value) return
  const capture = useAudioCapture({
    deviceId: selectedDeviceId.value || undefined,
    echoCancellation: advancedSettings.value.echoCancellation,
    noiseSuppression: advancedSettings.value.noiseSuppression,
    targetSampleRate: advancedSettings.value.targetSampleRate,
    chunkDurationMs: advancedSettings.value.chunkDurationMs,
    onAudioChunk: (base64Pcm) => {
      wsSend({ type: 'audio', data: base64Pcm })
    },
    onError: (msg) => {
      setStatus(msg, 'error')
    }
  })
  capture.volume.value = sliderToGain(micVolume.value)
  audioCapture.value = capture
  micVolumeWatcher.value = watch(micVolume, (v) => {
    const c = audioCapture.value
    if (c) c.volume.value = sliderToGain(v)
  })
  await capture.start()
  micWaveform.drawRealtimeWaveform(capture.analyserNode.value ?? null)
  isMicMonitoring.value = true
}

function stopMicCapture() {
  if (micVolumeWatcher.value) {
    micVolumeWatcher.value()
    micVolumeWatcher.value = null
  }
  if (audioCapture.value) {
    audioCapture.value.stop()
    audioCapture.value = null
  }
  isMicMonitoring.value = false
}

// ─── Audio file playback ───────────────────────────────────
function startFilePlayback() {
  if (!filePlayer.audioBuffer.value) {
    setStatus('请先选择音频文件', 'error')
    return
  }
  filePlayer.play()
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    statusMessage.value = ''
    filePlayer.loadFile(file)
  }
}

function handleSeek(event: Event) {
  const input = event.target as HTMLInputElement
  const time = parseFloat(input.value)
  filePlayer.seek(time)
}

function handleWaveformClick(event: MouseEvent) {
  if (!filePlayer.fileInfo.value || !filePlayer.audioBuffer.value) return
  const canvas = fileCanvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const progress = x / rect.width
  const time = progress * filePlayer.audioBuffer.value.duration
  filePlayer.seek(time)
}

function toggleFilePlayback() {
  if (filePlayer.isPlaying.value) {
    filePlayer.pause()
  } else if (filePlayer.audioBuffer.value) {
    filePlayer.play()
  }
}

// ─── Stop all capture ──────────────────────────────────────
function stopCapture() {
  micWaveform.stopAnimation()
  stopMicCapture()
  filePlayer.stop()
}

// ─── Fetch helpers ─────────────────────────────────────────
async function fetchASRConfig() {
  try {
    const data = await $fetch<Record<string, unknown>>('/api/asr/config')
    if (data.overlap_sec !== undefined) advancedSettings.value.overlapSec = data.overlap_sec as number
    if (data.memory_chunks !== undefined) advancedSettings.value.memoryChunks = data.memory_chunks as number
  } catch {
    // config API 不可用时忽略
  }
}

async function fetchServiceHealth() {
  try {
    const data = await $fetch<{
      status: string
      available_providers?: string[]
    }>('/api/asr/service-health')
    serviceHealth.value = {
      status: data.status === 'ok' ? 'ok' : 'offline',
      available_providers: data.available_providers,
    }
  } catch {
    serviceHealth.value = { status: 'offline' }
  }
}

async function startService() {
  serviceLoading.value = true
  try {
    await $fetch('/api/asr/service-start', { method: 'POST' })
    await fetchServiceHealth()
  } catch {
    // ignore, next poll will update
  } finally {
    serviceLoading.value = false
  }
}

async function stopService() {
  serviceLoading.value = true
  try {
    await $fetch('/api/asr/service-stop', { method: 'POST' })
    await fetchServiceHealth()
  } catch {
    // ignore
  } finally {
    serviceLoading.value = false
  }
}

// ─── Main actions ──────────────────────────────────────────
async function handleStart() {
  statusMessage.value = ''
  await transcription.startTranscription({
    source: source.value,
    ...(source.value === 'stream' ? { streamUrl: streamUrl.value || DEFAULT_STREAM_URL } : {}),
    provider: provider.value,
    overlapSec: advancedSettings.value.overlapSec,
    memoryChunks: advancedSettings.value.memoryChunks
  })
}

async function handleStop() {
  await transcription.stopTranscription()
}

function handleSourceSelect(newSource: 'mic' | 'file' | 'stream') {
  if (transcription.state.value === 'running') {
    // 运行中切换源
    transcription.switchSource({
      source: newSource,
      ...(newSource === 'stream' ? { streamUrl: streamUrl.value || DEFAULT_STREAM_URL } : {})
    })
  }
  source.value = newSource
  statusMessage.value = ''
}

// ─── Watchers ──────────────────────────────────────────────
// 同步文件音量
watch(fileVolume, (v) => {
  filePlayer.volume.value = sliderToGain(v)
})

// 文件播放进度 → 波形重绘
watch(() => filePlayer.currentTime.value, () => {
  if (filePlayer.waveformPeaks.value && filePlayer.audioBuffer.value) {
    const progress = filePlayer.currentTime.value / filePlayer.audioBuffer.value.duration
    fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, progress, fileVolume.value)
  }
})

// 音源切换（非运行态）
watch(source, (val) => {
  if (transcription.state.value === 'running') return
  statusMessage.value = ''
  stopMicCapture()
  micWaveform.stopAnimation()
  nextTick(() => {
    if (val === 'file') {
      micWaveform.drawRealtimeWaveform(null)
      if (filePlayer.waveformPeaks.value) {
        fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, 0, fileVolume.value)
      } else {
        fileWaveform.drawRealtimeWaveform(null)
      }
    }
  })
})

// 文件波形 peaks 变化时重绘
watch(() => filePlayer.waveformPeaks.value, (peaks) => {
  if (peaks && source.value === 'file') {
    nextTick(() => fileWaveform.drawStaticWaveform(peaks, 0, fileVolume.value))
  }
})

// 文件音量变化时重绘波形
watch(fileVolume, () => {
  if (source.value === 'file' && filePlayer.waveformPeaks.value && filePlayer.audioBuffer.value) {
    const progress = filePlayer.currentTime.value / filePlayer.audioBuffer.value.duration
    fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, progress, fileVolume.value)
  }
})

// 状态变化通知父组件
watch(transcription.state, (s) => {
  emit('status-change', s)
})

// 连接数和字幕数同步到父组件
watch([transcription.connectionCount, transcription.subtitleCount], ([cc, sc]) => {
  emit('counts-update', cc, sc)
}, { immediate: true })

// ─── Lifecycle ─────────────────────────────────────────────
onMounted(() => {
  if (import.meta.client) {
    fetchASRConfig()
    fetchServiceHealth()
  }
  enumerateDevices()
  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)

  // 定期轮询服务健康状态
  const healthInterval = setInterval(fetchServiceHealth, 3000)
  onUnmounted(() => {
    clearInterval(healthInterval)
  })
})

onUnmounted(() => {
  navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  stopCapture()
  filePlayer.destroy()
})
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
      </div>
      <span class="panel-title">转录控制</span>
    </div>

    <div class="panel-content">
      <!-- ── 音频源 ──────────────────────────────── -->
      <div class="section-label">
        <span class="section-text">音频源</span>
      </div>

      <div class="source-grid">
        <button
          class="source-btn"
          :class="{ active: source === 'mic' }"
          @click="handleSourceSelect('mic')"
        >
          麦克风
        </button>
        <button
          class="source-btn"
          :class="{ active: source === 'file' }"
          @click="handleSourceSelect('file')"
        >
          文件
        </button>
        <button
          class="source-btn"
          :class="{ active: source === 'stream' }"
          @click="handleSourceSelect('stream')"
        >
          流
        </button>
      </div>

      <!-- Mic Section -->
      <template v-if="source === 'mic'">
        <div class="form-row">
          <label class="form-label">设备</label>
          <select v-if="devicesReady === 'ready'" v-model="selectedDeviceId" class="form-input">
            <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">
              {{ d.label || `设备 ${devices.indexOf(d) + 1}` }}
            </option>
          </select>
          <div v-else class="form-input device-status" :class="devicesReady">
            {{ devicesReady === 'loading' ? '检测设备中...' : '未检测到麦克风' }}
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">波形</label>
          <div class="waveform-container">
            <canvas ref="micCanvasRef" class="waveform-canvas" />
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">
            音量
            <span class="volume-value">{{ gainToPercent(micVolume) }}</span>
          </label>
          <input
            type="range" min="0" max="10" step="0.1"
            v-model.number="micVolume"
            class="volume-bar"
          />
        </div>
      </template>

      <!-- File Section -->
      <template v-if="source === 'file'">
        <div class="form-row">
          <label class="form-label">音频文件</label>
          <div class="file-select-row">
            <input ref="fileInput" type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.wma,.aac,.webm" class="file-input-hidden" @change="handleFileSelect" />
            <button type="button" class="file-select-btn" @click="fileInput?.click()">
              {{ filePlayer.fileInfo.value ? filePlayer.fileInfo.value.name : '选择文件...' }}
            </button>
            <span v-if="filePlayer.fileInfo.value" class="file-duration">
              {{ formatTime(filePlayer.fileInfo.value.duration) }}
            </span>
          </div>
        </div>

        <div v-if="filePlayer.fileInfo.value" class="form-row">
          <label class="form-label">
            进度
            <div class="progress-controls">
              <span class="progress-time">
                {{ formatTime(filePlayer.currentTime.value) }} / {{ formatTime(filePlayer.fileInfo.value.duration) }}
              </span>
              <button class="ctrl-btn" @click="toggleFilePlayback">
                {{ filePlayer.isPlaying.value ? '暂停' : '播放' }}
              </button>
            </div>
          </label>
          <input
            type="range"
            :min="0"
            :max="filePlayer.fileInfo.value.duration"
            :step="0.01"
            :value="filePlayer.currentTime.value"
            class="progress-bar"
            @input="handleSeek"
          />
        </div>

        <div class="form-row">
          <label class="form-label">波形</label>
          <div class="waveform-container" @click="handleWaveformClick">
            <canvas ref="fileCanvasRef" class="waveform-canvas" />
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">
            音量
            <span class="volume-value">{{ gainToPercent(fileVolume) }}</span>
          </label>
          <input
            type="range" min="0" max="10" step="0.1"
            v-model.number="fileVolume"
            class="volume-bar"
          />
        </div>
      </template>

      <!-- Stream Section -->
      <template v-if="source === 'stream'">
        <div class="form-row">
          <label class="form-label">流地址</label>
          <input
            v-model="streamUrl"
            type="text"
            class="form-input"
            placeholder="默认"
          />
        </div>
      </template>

      <!-- ── 状态 ────────────────────────────────── -->
      <div class="section-label">
        <span class="section-text">状态</span>
      </div>

      <!-- Status block -->
      <div class="status-block">
        <div class="status-main-row">
          <div class="status-main-left">
            <span class="status-dot" :style="{ background: stateColor }"></span>
            <span class="status-state-text" :class="stateClass">{{ stateLabel }}</span>
          </div>
          <span v-if="transcription.uptime.value > 0" class="status-uptime">{{ formatUptime(transcription.uptime.value) }}</span>
        </div>

        <!-- Progress step -->
        <div v-if="transcription.currentStep.value" class="progress-step">
          <div class="progress-spinner"></div>
          <span>{{ stepLabels[transcription.currentStep.value] || transcription.currentStep.value }}</span>
        </div>

        <!-- Audio / Recognition sub-status -->
        <div class="sub-status-grid">
          <div class="sub-status-row">
            <span class="sub-status-label">音频</span>
            <span class="sub-status-value">
              <span
                class="sub-dot"
                :class="{ active: transcription.audio.value.active }"
                :style="{ background: transcription.audio.value.active ? '#22d3ee' : '#94a3b8' }"
              ></span>
              {{ transcription.audio.value.active ? transcription.audio.value.label : '未启动' }}
            </span>
          </div>
          <div class="sub-status-row">
            <span class="sub-status-label">识别</span>
            <span class="sub-status-value">
              <span
                class="sub-dot"
                :class="{ active: transcription.recognition.value.active }"
                :style="{ background: transcription.recognition.value.active ? '#22d3ee' : '#94a3b8' }"
              ></span>
              {{ transcription.recognition.value.active ? '运行中' : (transcription.recognition.value.detail || '已停止') }}
            </span>
          </div>
        </div>

        <!-- Error message -->
        <div v-if="transcription.error.value" class="error-message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{{ transcription.error.value }}</span>
        </div>
      </div>

      <!-- Connection / Subtitle info -->
      <div class="info-row">
        <div class="info-item">
          <span class="info-label">连接</span>
          <span class="info-value">{{ transcription.connectionCount.value }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">字幕</span>
          <span class="info-value">{{ transcription.subtitleCount.value }}</span>
        </div>
      </div>

      <!-- Status Message (audio source related) -->
      <div v-if="statusMessage" class="status-message" :class="statusType">
        <svg v-if="statusType === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span>{{ statusMessage }}</span>
      </div>

      <!-- ── Action buttons ──────────────────────── -->
      <div class="action-row">
        <button
          v-if="canStart"
          class="action-btn start"
          @click="handleStart"
        >
          {{ transcription.state.value === 'error' ? '重新开始' : '开始转录' }}
        </button>
        <button
          v-else-if="canStop"
          class="action-btn stop"
          @click="handleStop"
        >
          停止转录
        </button>
        <button
          v-else
          class="action-btn"
          :class="transcription.state.value === 'starting' ? 'starting' : 'stopping'"
          disabled
        >
          {{ transcription.state.value === 'starting' ? '启动中...' : '停止中...' }}
        </button>
      </div>

      <!-- ── Advanced ────────────────────────────── -->
      <div class="advanced-row">
        <button class="advanced-toggle" @click="showAdvanced = !showAdvanced">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toggle-icon" :class="{ rotated: showAdvanced }">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          高级
        </button>
      </div>

      <div v-if="showAdvanced" class="advanced-settings">
        <!-- Engine selection -->
        <div class="form-row">
          <label class="form-label">引擎</label>
          <div class="provider-grid">
            <button
              v-for="p in availableProviders"
              :key="p"
              class="provider-btn"
              :class="{ active: provider === p }"
              :disabled="!canStart"
              @click="provider = p"
            >
              {{ p }}
            </button>
          </div>
        </div>

        <!-- Sample rate -->
        <div class="form-row">
          <label class="form-label">输出采样率 (Hz)</label>
          <select v-model.number="advancedSettings.targetSampleRate" class="form-input">
            <option :value="8000">8000</option>
            <option :value="16000">16000</option>
            <option :value="48000">48000</option>
          </select>
        </div>

        <!-- Chunk size -->
        <div class="form-row">
          <label class="form-label">分块大小 (ms)</label>
          <select v-model.number="advancedSettings.chunkDurationMs" class="form-input">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </div>

        <!-- Overlap -->
        <div class="form-row">
          <label class="form-label">重叠 (秒)</label>
          <select v-model.number="advancedSettings.overlapSec" class="form-input">
            <option :value="0">0</option>
            <option :value="0.05">0.05</option>
            <option :value="0.1">0.1</option>
            <option :value="0.3">0.3</option>
            <option :value="0.5">0.5</option>
          </select>
        </div>

        <!-- Memory chunks -->
        <div class="form-row">
          <label class="form-label">记忆块数</label>
          <select v-model.number="advancedSettings.memoryChunks" class="form-input">
            <option :value="0">0</option>
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="3">3</option>
            <option :value="5">5</option>
          </select>
        </div>

        <!-- Echo cancellation (mic only) -->
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input type="checkbox" v-model="advancedSettings.echoCancellation" />
            <span>回声消除</span>
          </label>
        </div>

        <!-- Noise suppression (mic only) -->
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input type="checkbox" v-model="advancedSettings.noiseSuppression" />
            <span>降噪</span>
          </label>
        </div>

        <!-- Service control -->
        <div class="service-control">
          <div class="service-control-header">
            <span class="form-label">识别服务</span>
            <span
              class="service-status-badge"
              :class="serviceHealth.status === 'ok' ? 'online' : 'offline'"
            >
              {{ serviceHealth.status === 'ok' ? '在线' : '离线' }}
            </span>
          </div>
          <div class="service-control-actions">
            <button
              v-if="serviceHealth.status !== 'ok'"
              class="service-btn start"
              :disabled="serviceLoading || !canStart"
              @click="startService"
            >
              {{ serviceLoading ? '正在启动...' : '启动' }}
            </button>
            <button
              v-else
              class="service-btn stop"
              :disabled="serviceLoading || !canStart"
              @click="stopService"
            >
              {{ serviceLoading ? '正在停止...' : '停止' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

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

.panel-icon svg { width: 20px; height: 20px; }

.panel-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* ── Section labels ── */
.section-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.section-text {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.5);
  text-transform: uppercase;
  white-space: nowrap;
}

.section-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(56, 189, 248, 0.1);
}

/* ── Source grid ── */
.source-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

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

.source-btn:hover {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
}

.source-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

/* ── Form rows ── */
.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.8);
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.device-status {
  color: rgba(148, 163, 184, 0.6);
  font-size: 0.8rem;
}

.device-status.empty {
  color: rgba(248, 113, 113, 0.7);
}

/* ── File section ── */
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

.file-select-btn:hover {
  border-color: rgba(56, 189, 248, 0.4);
}

.file-duration {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: #38bdf8;
  white-space: nowrap;
}

.file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.progress-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.progress-time {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
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

.ctrl-btn {
  padding: 0.3rem 0.6rem;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 6px;
  color: #38bdf8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.ctrl-btn:hover {
  background: rgba(56, 189, 248, 0.2);
}

/* ── Volume ── */
.volume-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.8rem;
  font-weight: 500;
  color: #38bdf8;
  min-width: 3em;
  text-align: right;
}

.volume-bar {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.volume-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #38bdf8;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
}

/* ── Waveform ── */
.waveform-container {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(56, 189, 248, 0.15);
}

.waveform-canvas {
  width: 100%;
  height: 60px;
  display: block;
}

/* ── Status block ── */
.status-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.1);
}

.status-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-main-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-state-text {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.state-idle { color: #94a3b8; }
.state-starting { color: #fbbf24; }
.state-running { color: #22d3ee; }
.state-stopping { color: #fbbf24; }
.state-error { color: #f87171; }

.status-uptime {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  color: rgba(56, 189, 248, 0.8);
  letter-spacing: 0.05em;
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: rgba(251, 191, 36, 0.08);
  border-radius: 6px;
  font-size: 0.7rem;
  color: #fbbf24;
}

.progress-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(251, 191, 36, 0.3);
  border-top-color: #fbbf24;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.sub-status-grid {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.sub-status-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.sub-status-label {
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.6);
  min-width: 2.5em;
  letter-spacing: 0.05em;
}

.sub-status-value {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.8);
}

.sub-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  font-size: 0.7rem;
  color: #f87171;
}

.error-message svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* ── Info row ── */
.info-row {
  display: flex;
  gap: 1rem;
}

.info-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  border-left: 3px solid rgba(56, 189, 248, 0.3);
}

.info-label {
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.6);
  letter-spacing: 0.05em;
}

.info-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  font-weight: 600;
  color: #38bdf8;
}

/* ── Status message ── */
.status-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.75rem;
}

.status-message.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.status-message.info {
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  color: #38bdf8;
}

.status-message svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* ── Action buttons ── */
.action-row {
  margin-top: 0.25rem;
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

.action-btn.start:hover {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.2));
  border-color: rgba(16, 185, 129, 0.6);
}

.action-btn.stop {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1));
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

.action-btn.stop:hover {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(239, 68, 68, 0.2));
  border-color: rgba(239, 68, 68, 0.6);
}

.action-btn.starting {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.05));
  border-color: rgba(251, 191, 36, 0.3);
  color: #fbbf24;
}

.action-btn.stopping {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.05));
  border-color: rgba(251, 191, 36, 0.3);
  color: #fbbf24;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Advanced ── */
.advanced-row {
  display: flex;
}

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

.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.provider-btn {
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

.provider-btn:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
}

.provider-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

.provider-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.check-label input[type="checkbox"] {
  accent-color: #38bdf8;
}

.check-label span {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: #94a3b8;
  letter-spacing: 0.1em;
}

/* ── Service control ── */
.service-control {
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.08);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.service-control-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.service-status-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  letter-spacing: 0.08em;
}

.service-status-badge.online {
  background: rgba(34, 211, 238, 0.1);
  color: #22d3ee;
  border: 1px solid rgba(34, 211, 238, 0.3);
}

.service-status-badge.offline {
  background: rgba(148, 163, 184, 0.1);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.service-control-actions {
  display: flex;
  gap: 0.5rem;
}

.service-btn {
  flex: 1;
  padding: 0.5rem;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid;
}

.service-btn.start {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}

.service-btn.start:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.2);
}

.service-btn.stop {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
  color: rgba(239, 68, 68, 0.8);
}

.service-btn.stop:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
}

.service-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
