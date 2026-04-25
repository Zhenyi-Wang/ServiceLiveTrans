<script setup lang="ts">
const props = defineProps<{
  isRunning: boolean
  isLoading: boolean
  wsSend: (data: any) => boolean
}>()

const emit = defineEmits<{
  start: [config: { provider: string; model: string; source: string }]
  stop: []
}>()

const source = ref<'mic' | 'file'>('mic')
const provider = ref('whisper')

const devices = ref<MediaDeviceInfo[]>([])
const selectedDeviceId = ref<string>('')
const statusMessage = ref('')
const statusType = ref<'error' | 'info'>('error')

const fileInput = ref<HTMLInputElement | null>(null)
const filePlayer = useAudioFilePlayer({
  onAudioChunk: (base64Pcm) => {
    props.wsSend({ type: 'audio', data: base64Pcm })
  },
  onError: (msg) => { setStatus(msg, 'error') },
  onEnded: () => { setStatus('文件播放完毕', 'info') }
})

const micCanvasRef = ref<HTMLCanvasElement | null>(null)
const fileCanvasRef = ref<HTMLCanvasElement | null>(null)
const micWaveform = useWaveformRenderer(micCanvasRef)
const fileWaveform = useWaveformRenderer(fileCanvasRef)

const showAdvanced = ref(false)

const serviceHealth = ref<{
  status: 'ok' | 'offline'
  available_providers?: string[]
  process?: { pid: number | null; selfStarted: boolean }
}>({ status: 'offline' })

const isStarting = ref(false)

const serviceStatus = computed(() => {
  if (isStarting.value) return 'starting'
  if (props.isRunning) return 'ready'
  return serviceHealth.value.status === 'ok' ? 'ready' : 'offline'
})

const serviceStatusText = computed(() => {
  const s = serviceStatus.value
  if (s === 'ready') return 'READY'
  if (s === 'starting') return 'STARTING'
  return 'OFFLINE'
})

const availableProviders = computed(() => {
  return serviceHealth.value.available_providers?.length
    ? serviceHealth.value.available_providers!
    : ['gguf']
})

async function fetchServiceHealth() {
  try {
    const data = await $fetch<{
      status: string
      available_providers?: string[]
      process?: { pid: number | null; selfStarted: boolean }
    }>('/api/asr/service-health')
    serviceHealth.value = {
      status: data.status === 'ok' ? 'ok' : 'offline',
      available_providers: data.available_providers,
      process: data.process,
    }
  } catch {
    serviceHealth.value = { status: 'offline' }
  }
}

const { pause: pauseHealthPoll, resume: resumeHealthPoll } = useIntervalFn(
  fetchServiceHealth,
  3000,
  { immediate: true }
)
const advancedSettings = ref({
  targetSampleRate: 16000,
  chunkDurationMs: 100,
  echoCancellation: true,
  noiseSuppression: true
})

let audioCapture: ReturnType<typeof useAudioCapture> | null = null

function setStatus(msg: string, type: 'error' | 'info') {
  statusMessage.value = msg
  statusType.value = type
}

async function enumerateDevices() {
  try {
    const allDevices = await navigator.mediaDevices.enumerateDevices()
    devices.value = allDevices.filter(d => d.kind === 'audioinput')
    if (devices.value.length > 0 && !selectedDeviceId.value) {
      selectedDeviceId.value = devices.value[0].deviceId
    }
  } catch {
    setStatus('需要 HTTPS 或 localhost 环境才能访问麦克风', 'error')
  }
}

function handleDeviceChange() {
  enumerateDevices()
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    statusMessage.value = ''
    filePlayer.loadFile(file)
  }
}

function triggerFileInput() {
  fileInput.value?.click()
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function handleStart() {
  statusMessage.value = ''

  // 互斥检查：检查 LiveTrans 是否在运行
  try {
    const liveStatus = await $fetch<{ state: string }>('/api/live/status')
    if (liveStatus.state !== 'idle') {
      setStatus('请先停止直播转录', 'error')
      return
    }
  } catch {
    // live status API 不可用时忽略
  }

  emit('start', {
    provider: provider.value,
    model: '',
    source: source.value
  })
}

async function handleStartSuccess() {
  if (source.value === 'mic') {
    await startMicCapture()
  } else {
    startFilePlayback()
  }
}

async function startMicCapture() {
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
      setStatus(msg, 'error')
    }
  })
  await audioCapture.start()
  micWaveform.drawRealtimeWaveform(audioCapture.analyserNode.value ?? null)
}

function startFilePlayback() {
  if (!filePlayer.audioBuffer.value) {
    setStatus('请先选择音频文件', 'error')
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
  if (audioCapture) {
    audioCapture.stop()
    audioCapture = null
  }
  filePlayer.stop()
}

defineExpose({
  handleStartSuccess,
  stopCapture
})

watch(() => filePlayer.currentTime.value, () => {
  if (filePlayer.waveformPeaks.value && filePlayer.audioBuffer.value) {
    const progress = filePlayer.currentTime.value / filePlayer.audioBuffer.value.duration
    fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, progress)
  }
})

watch(source, (val) => {
  statusMessage.value = ''
  micWaveform.stopAnimation()
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

watch(() => filePlayer.waveformPeaks.value, (peaks) => {
  if (peaks && source.value === 'file') {
    nextTick(() => {
      fileWaveform.drawStaticWaveform(peaks, 0)
    })
  }
})

onMounted(() => {
  resumeHealthPoll()
  enumerateDevices()
  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
  nextTick(() => {
    micWaveform.drawIdle()
  })
})

onUnmounted(() => {
  pauseHealthPoll()
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
      <span class="panel-title">ASR CONTROL</span>
      <span v-if="isRunning" class="status-badge active">LIVE</span>
    </div>

    <div class="panel-content">
      <!-- Service Status -->
      <div class="form-row">
        <label class="form-label">SERVICE</label>
        <div class="service-status" :class="serviceStatus">
          <span class="service-dot" />
          <span class="service-text">{{ serviceStatusText }}</span>
          <span v-if="serviceHealth.value.process?.selfStarted" class="service-pid">
            PID {{ serviceHealth.value.process.pid }}
          </span>
        </div>
      </div>

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
          >Microphone</button>
          <button
            class="source-btn"
            :class="{ active: source === 'file' }"
            :disabled="isRunning"
            @click="source = 'file'"
          >File</button>
        </div>
      </div>

      <!-- Mic: Device Selection -->
      <div v-if="source === 'mic'" class="form-row">
        <label class="form-label">DEVICE</label>
        <select
          v-model="selectedDeviceId"
          class="form-input"
          :disabled="isRunning"
        >
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
        <input ref="fileInput" type="file" accept="audio/*" class="hidden" @change="handleFileSelect" />
      </div>

      <!-- File: Progress Bar -->
      <div v-if="source === 'file' && filePlayer.fileInfo.value" class="form-row">
        <label class="form-label">
          PROGRESS
          <span class="progress-time">
            {{ formatTime(filePlayer.currentTime.value) }} / {{ formatTime(filePlayer.fileInfo.value.duration) }}
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
          >PLAY</button>
          <button
            v-if="filePlayer.isPlaying.value && !isRunning"
            class="ctrl-btn"
            @click="filePlayer.pause()"
          >PAUSE</button>
        </div>
      </div>

      <!-- File: Waveform -->
      <div v-if="source === 'file'" class="form-row">
        <label class="form-label">WAVEFORM</label>
        <div class="waveform-container" @click="handleWaveformClick">
          <canvas ref="fileCanvasRef" class="waveform-canvas" />
        </div>
      </div>

      <!-- Status Message -->
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

      <!-- Advanced Settings -->
      <div class="form-row">
        <button class="advanced-toggle" @click="showAdvanced = !showAdvanced">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toggle-icon" :class="{ rotated: showAdvanced }">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          ADVANCED SETTINGS
        </button>
      </div>

      <div v-if="showAdvanced" class="advanced-settings">
        <div class="form-row">
          <label class="form-label">OUTPUT SAMPLE RATE (Hz)</label>
          <select v-model.number="advancedSettings.targetSampleRate" class="form-input" :disabled="isRunning">
            <option :value="8000">8000</option>
            <option :value="16000">16000</option>
            <option :value="48000">48000</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">CHUNK SIZE (ms)</label>
          <select v-model.number="advancedSettings.chunkDurationMs" class="form-input" :disabled="isRunning">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </div>
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input type="checkbox" v-model="advancedSettings.echoCancellation" :disabled="isRunning" />
            <span>ECHO CANCELLATION</span>
          </label>
        </div>
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input type="checkbox" v-model="advancedSettings.noiseSuppression" :disabled="isRunning" />
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
        <button
          v-else
          class="action-btn stop"
          :disabled="isLoading"
          @click="handleStopClick"
        >
          STOP ASR
        </button>
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

.provider-grid, .source-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.provider-btn, .source-btn {
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

.provider-btn:hover:not(:disabled), .source-btn:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
}

.provider-btn.active, .source-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

.provider-btn:disabled, .source-btn:disabled {
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

.waveform-container {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(56, 189, 248, 0.15);
  cursor: default;
}

.waveform-container[style*="cursor"] {
  cursor: pointer;
}

.waveform-canvas {
  width: 100%;
  display: block;
}

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

.check-label input[type="checkbox"] {
  accent-color: #38bdf8;
}

.check-label span {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: #94a3b8;
  letter-spacing: 0.1em;
}

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

.service-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
}

.service-status.ready {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #10b981;
}

.service-status.offline {
  background: rgba(100, 116, 139, 0.1);
  border: 1px solid rgba(100, 116, 139, 0.3);
  color: #64748b;
}

.service-status.starting {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #f59e0b;
  animation: pulse 1.5s ease-in-out infinite;
}

.service-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.service-text {
  font-weight: 600;
}

.service-pid {
  margin-left: auto;
  opacity: 0.6;
  font-size: 0.6rem;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
</style>
