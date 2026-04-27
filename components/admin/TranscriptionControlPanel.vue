<script setup lang="ts">
import type { WSMessage, AudioSourceCommandData, TranscriptionStatusData } from '~/types/websocket'
import { asrConfigToCamel } from '~/types/asr'
import type { ASRConfig } from '~/types/asr'

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
        stopMicCapture()
        startMicCapture()
      }
    } else if (msg.type === 'audio-source-stop') {
      stopCapture()
    }
    // 处理转录状态消息
    transcription.handleWSMessage(msg)
    // 同步音频源类型和 ASR 配置
    if (msg.type === 'init' || msg.type === 'transcription-status') {
      const ts = msg.data as TranscriptionStatusData
      if (ts.source) {
        source.value = ts.source
      }
      if (ts.asrConfig) {
        syncASRConfig(ts.asrConfig)
      }
    }
  }
})

// ─── Audio source ──────────────────────────────────────────
const source = ref<'mic' | 'stream'>('mic')
const DEFAULT_STREAM_URL = 'http://mini:8080/live/livestream.flv'
const streamUrl = ref('')

const devices = ref<MediaDeviceInfo[]>([])
const devicesReady = ref<'loading' | 'ready' | 'empty'>('loading')
const selectedDeviceId = ref<string>('')
const statusMessage = ref('')
const statusType = ref<'error' | 'info'>('error')

const micCanvasRef = ref<HTMLCanvasElement | null>(null)
const micWaveform = useWaveformRenderer(micCanvasRef)

const showAdvanced = ref(false)

const micVolume = useLocalStorage('asr-mic-volume', 5)

// ─── Advanced settings ─────────────────────────────────────
const advancedSettings = ref({
  targetSampleRate: 16000,
  chunkDurationMs: 100,
  echoCancellation: true,
  noiseSuppression: true,
  overlapSec: 0.1,
  memoryChunks: 2,
  vadThreshold: 0.5,
  vadMaxBufferSec: 10.0,
  vadMinBufferSec: 0.5,
  vadSilenceMs: 300,
  temperature: 0.4,
  language: 'Chinese',
  sendPartial: false,
  sentenceMinLen: 5,
  rollbackNum: 5,
})

const provider = ref('gguf')

const availableProviders = ref<string[]>(['gguf'])

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

async function startMicCapture(sendAudio = true) {
  if (isMicMonitoring.value) return
  const capture = useAudioCapture({
    deviceId: selectedDeviceId.value || undefined,
    echoCancellation: advancedSettings.value.echoCancellation,
    noiseSuppression: advancedSettings.value.noiseSuppression,
    targetSampleRate: advancedSettings.value.targetSampleRate,
    chunkDurationMs: advancedSettings.value.chunkDurationMs,
    onAudioChunk: sendAudio ? (base64Pcm) => {
      wsSend({ type: 'audio', data: base64Pcm })
    } : undefined,
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

// ─── Stop all capture ──────────────────────────────────────
function stopCapture() {
  micWaveform.stopAnimation()
  stopMicCapture()
}

// ─── Fetch helpers ─────────────────────────────────────────
function syncASRConfig(data: Record<string, unknown>) {
  const camel = asrConfigToCamel(data)
  const s = advancedSettings.value
  if (camel.overlapSec !== undefined) s.overlapSec = camel.overlapSec
  if (camel.memoryChunks !== undefined) s.memoryChunks = camel.memoryChunks
  if (camel.vadThreshold !== undefined) s.vadThreshold = camel.vadThreshold
  if (camel.vadMaxBufferSec !== undefined) s.vadMaxBufferSec = camel.vadMaxBufferSec
  if (camel.vadMinBufferSec !== undefined) s.vadMinBufferSec = camel.vadMinBufferSec
  if (camel.vadSilenceMs !== undefined) s.vadSilenceMs = camel.vadSilenceMs
  if (camel.temperature !== undefined) s.temperature = camel.temperature
  if (camel.language !== undefined) s.language = camel.language
  if (camel.sendPartial !== undefined) s.sendPartial = camel.sendPartial
  if (camel.sentenceMinLen !== undefined) s.sentenceMinLen = camel.sentenceMinLen
  if (camel.rollbackNum !== undefined) s.rollbackNum = camel.rollbackNum
}
async function fetchASRConfig() {
  try {
    const data = await $fetch<Record<string, unknown>>('/api/asr/config')
    syncASRConfig(data)
  } catch {
    // config API 不可用时忽略
  }
}

// ─── Main actions ──────────────────────────────────────────
function buildASRConfig(): ASRConfig {
  const s = advancedSettings.value
  return {
    provider: provider.value,
    overlapSec: s.overlapSec,
    memoryChunks: s.memoryChunks,
    vadThreshold: s.vadThreshold,
    vadMaxBufferSec: s.vadMaxBufferSec,
    vadMinBufferSec: s.vadMinBufferSec,
    vadSilenceMs: s.vadSilenceMs,
    temperature: s.temperature,
    language: s.language,
    sendPartial: s.sendPartial,
    sentenceMinLen: s.sentenceMinLen,
    rollbackNum: s.rollbackNum,
  }
}
// ─── Independent audio/recognition toggles ────────────────
const audioLoading = ref(false)
const recognitionLoading = ref(false)

async function toggleAudio() {
  if (audioLoading.value) return

  if (!transcription.audio.value.active) {
    if (!transcription.recognition.value.active) {
      setStatus('请先启动识别服务', 'error')
      return
    }
    audioLoading.value = true
    try {
      await transcription.startAudioOnly({
        source: source.value,
        ...(source.value === 'stream' ? { streamUrl: streamUrl.value || DEFAULT_STREAM_URL } : {}),
      })
    } finally {
      audioLoading.value = false
    }
  } else {
    audioLoading.value = true
    try {
      await transcription.stopAudioOnly()
    } finally {
      audioLoading.value = false
    }
  }
}

async function toggleRecognition() {
  if (recognitionLoading.value) return

  if (!transcription.recognition.value.active) {
    recognitionLoading.value = true
    try {
      await transcription.startRecognitionOnly({
        ...buildASRConfig(),
      })
    } finally {
      recognitionLoading.value = false
    }
  } else {
    if (transcription.audio.value.active) {
      if (!confirm('音频源正在运行，是否一并停止？')) {
        recognitionLoading.value = true
        try {
          await transcription.stopRecognitionOnly()
        } finally {
          recognitionLoading.value = false
        }
        return
      }
      recognitionLoading.value = true
      audioLoading.value = true
      try {
        await transcription.stopRecognitionOnly()
        await transcription.stopAudioOnly()
      } finally {
        recognitionLoading.value = false
        audioLoading.value = false
      }
    } else {
      recognitionLoading.value = true
      try {
        await transcription.stopRecognitionOnly()
      } finally {
        recognitionLoading.value = false
      }
    }
  }
}

function handleSourceSelect(newSource: 'mic' | 'stream') {
  if (transcription.state.value === 'running') {
    transcription.switchSource({
      source: newSource,
      ...(newSource === 'stream' ? { streamUrl: streamUrl.value || DEFAULT_STREAM_URL } : {})
    })
  }
  source.value = newSource
  statusMessage.value = ''
}

// ─── Watchers ──────────────────────────────────────────────
// 音源切换（非运行态）
watch(source, (val) => {
  if (transcription.state.value === 'running') return
  statusMessage.value = ''
  stopMicCapture()
  micWaveform.stopAnimation()
  nextTick(async () => {
    if (val === 'mic') {
      await startMicCapture(false)
    }
  })
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
  }
  enumerateDevices()
  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
})

onUnmounted(() => {
  navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  stopCapture()
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
            <span class="volume-value"><ClientOnly>{{ gainToPercent(micVolume) }}</ClientOnly></span>
          </label>
          <input
            type="range" min="0" max="10" step="0.1"
            v-model.number="micVolume"
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
            <span class="sub-status-label">音频服务</span>
            <span class="sub-status-value">
              <span
                class="sub-dot"
                :class="{ active: transcription.audio.value.active }"
                :style="{ background: transcription.audio.value.active ? '#22d3ee' : '#94a3b8' }"
              ></span>
              {{ transcription.audio.value.active ? transcription.audio.value.label : '未启动' }}
            </span>
            <button
              class="sub-toggle-btn"
              :class="transcription.audio.value.active ? 'on' : 'off'"
              :disabled="audioLoading || isTransitioning"
              @click="toggleAudio"
            >
              {{ audioLoading ? '...' : (transcription.audio.value.active ? '停止' : '启动') }}
            </button>
          </div>
          <div class="sub-status-row">
            <span class="sub-status-label">识别服务</span>
            <span class="sub-status-value">
              <span
                class="sub-dot"
                :class="{ active: transcription.recognition.value.active }"
                :style="{ background: transcription.recognition.value.active ? '#22d3ee' : '#94a3b8' }"
              ></span>
              {{ transcription.recognition.value.active ? '运行中' : (transcription.recognition.value.detail || '已停止') }}
            </span>
            <button
              class="sub-toggle-btn"
              :class="transcription.recognition.value.active ? 'on' : 'off'"
              :disabled="recognitionLoading || isTransitioning"
              @click="toggleRecognition"
            >
              {{ recognitionLoading ? '...' : (transcription.recognition.value.active ? '停止' : '启动') }}
            </button>
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

        <!-- ── VAD 设置 ── -->
        <div class="section-label">
          <span class="section-text">VAD</span>
        </div>

        <div class="form-row">
          <label class="form-label">语音阈值</label>
          <select v-model.number="advancedSettings.vadThreshold" class="form-input">
            <option :value="0.3">0.3 (灵敏)</option>
            <option :value="0.4">0.4</option>
            <option :value="0.5">0.5 (默认)</option>
            <option :value="0.6">0.6</option>
            <option :value="0.7">0.7 (严格)</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">最大缓冲 (秒)</label>
          <select v-model.number="advancedSettings.vadMaxBufferSec" class="form-input">
            <option :value="5">5</option>
            <option :value="8">8</option>
            <option :value="10">10 (默认)</option>
            <option :value="15">15</option>
            <option :value="20">20</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">最小缓冲 (秒)</label>
          <select v-model.number="advancedSettings.vadMinBufferSec" class="form-input">
            <option :value="0.3">0.3</option>
            <option :value="0.5">0.5 (默认)</option>
            <option :value="0.8">0.8</option>
            <option :value="1.0">1.0</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">静音检测 (ms)</label>
          <select v-model.number="advancedSettings.vadSilenceMs" class="form-input">
            <option :value="200">200</option>
            <option :value="300">300 (默认)</option>
            <option :value="500">500</option>
            <option :value="700">700</option>
            <option :value="1000">1000</option>
          </select>
        </div>

        <!-- ── ASR 引擎 ── -->
        <div class="section-label">
          <span class="section-text">引擎</span>
        </div>

        <div class="form-row">
          <label class="form-label">语言</label>
          <select v-model="advancedSettings.language" class="form-input">
            <option value="Chinese">Chinese</option>
            <option value="English">English</option>
            <option value="Japanese">Japanese</option>
            <option value="Korean">Korean</option>
            <option value="Auto">Auto</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">温度</label>
          <select v-model.number="advancedSettings.temperature" class="form-input">
            <option :value="0.0">0.0 (确定性)</option>
            <option :value="0.2">0.2</option>
            <option :value="0.4">0.4 (默认)</option>
            <option :value="0.6">0.6</option>
            <option :value="0.8">0.8</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">回滚 token</label>
          <select v-model.number="advancedSettings.rollbackNum" class="form-input">
            <option :value="0">0</option>
            <option :value="3">3</option>
            <option :value="5">5 (默认)</option>
            <option :value="10">10</option>
            <option :value="15">15</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">最短句长</label>
          <select v-model.number="advancedSettings.sentenceMinLen" class="form-input">
            <option :value="0">0</option>
            <option :value="3">3</option>
            <option :value="5">5 (默认)</option>
            <option :value="8">8</option>
            <option :value="10">10</option>
          </select>
        </div>

        <div class="form-row advanced-check-row">
          <label class="check-label">
            <input type="checkbox" v-model="advancedSettings.sendPartial" />
            <span>中间结果</span>
          </label>
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
  grid-template-columns: repeat(2, 1fr);
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

.sub-toggle-btn {
  margin-left: auto;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid;
  flex-shrink: 0;
}

.sub-toggle-btn.off {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}

.sub-toggle-btn.off:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.2);
}

.sub-toggle-btn.on {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
  color: rgba(239, 68, 68, 0.8);
}

.sub-toggle-btn.on:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
}

.sub-toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

</style>
