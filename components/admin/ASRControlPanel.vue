<script setup lang="ts">
const props = defineProps<{
  activeSource: string | null
  wsSend: (data: any) => boolean
}>()

const emit = defineEmits<{
  save: [config: { source: string; streamUrl?: string; overlapSec?: number; memoryChunks?: number }]
}>()

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

const micVolume = ref(5)
const fileVolume = ref(5)

// slider 0-10 → gain 0-10（指数曲线）
// s=0: mute, s=5: gain=1(100%), s=10: gain=10(1000%)
function sliderToGain(s: number): number {
  if (s <= 0) return 0
  if (s <= 5) return Math.pow(10, (s / 5 - 1) * 3)
  return 1 + (s - 5) / 5 * 9
}

function gainToPercent(s: number): string {
  return Math.round(sliderToGain(s) * 100) + '%'
}

async function fetchASRConfig() {
  try {
    const data = await $fetch<Record<string, unknown>>('/api/asr/config')
    if (data.overlap_sec !== undefined) advancedSettings.value.overlapSec = data.overlap_sec as number
    if (data.memory_chunks !== undefined) advancedSettings.value.memoryChunks = data.memory_chunks as number
  } catch {
    // config API 不可用时忽略
  }
}

const advancedSettings = ref({
  targetSampleRate: 16000,
  chunkDurationMs: 100,
  echoCancellation: true,
  noiseSuppression: true,
  overlapSec: 0.1,
  memoryChunks: 2
})

const isMicMonitoring = ref(false)
const micVolumeWatcher = ref<WatchStopHandle | null>(null)
const audioCapture = shallowRef<ReturnType<typeof useAudioCapture> | null>(null)

function setStatus(msg: string, type: 'error' | 'info') {
  statusMessage.value = msg
  statusType.value = type
}

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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function handleSave() {
  statusMessage.value = ''
  emit('save', {
    source: source.value,
    ...(source.value === 'stream' ? { streamUrl: streamUrl.value || DEFAULT_STREAM_URL } : {}),
    overlapSec: advancedSettings.value.overlapSec,
    memoryChunks: advancedSettings.value.memoryChunks
  })
  setStatus('配置已保存', 'info')
}

async function handleStartSuccess() {
  if (source.value === 'mic') {
    await startMicCapture()
  } else if (source.value === 'file') {
    startFilePlayback()
  }
}

async function startMicCapture() {
  if (isMicMonitoring.value) return
  const capture = useAudioCapture({
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

function startFilePlayback() {
  if (!filePlayer.audioBuffer.value) {
    setStatus('请先选择音频文件', 'error')
    return
  }
  filePlayer.play()
}

function handleStopClick() {
  stopCapture()
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

function stopCapture() {
  micWaveform.stopAnimation()
  stopMicCapture()
  filePlayer.stop()
}

function toggleFilePlayback() {
  if (filePlayer.isPlaying.value) {
    filePlayer.pause()
  } else if (filePlayer.audioBuffer.value) {
    filePlayer.play()
  }
}

// 同步文件音量
watch(fileVolume, (v) => {
  filePlayer.volume.value = sliderToGain(v)
})

defineExpose({
  handleStartSuccess,
  stopCapture
})

watch(() => filePlayer.currentTime.value, () => {
  if (filePlayer.waveformPeaks.value && filePlayer.audioBuffer.value) {
    const progress = filePlayer.currentTime.value / filePlayer.audioBuffer.value.duration
    fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, progress, fileVolume.value)
  }
})

watch(source, (val) => {
  statusMessage.value = ''
  stopMicCapture()
  micWaveform.stopAnimation()
  nextTick(async () => {
    if (val === 'mic') {
      await startMicCapture()
    } else if (val === 'file') {
      micWaveform.drawRealtimeWaveform(null)
      if (filePlayer.waveformPeaks.value) {
        fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, 0, fileVolume.value)
      } else {
        fileWaveform.drawRealtimeWaveform(null)
      }
    }
  })
})

watch(() => filePlayer.waveformPeaks.value, (peaks) => {
  if (peaks && source.value === 'file') {
    nextTick(() => fileWaveform.drawStaticWaveform(peaks, 0, fileVolume.value))
  }
})

// 音量变化时重绘文件波形
watch(fileVolume, () => {
  if (source.value === 'file' && filePlayer.waveformPeaks.value && filePlayer.audioBuffer.value) {
    const progress = filePlayer.currentTime.value / filePlayer.audioBuffer.value.duration
    fileWaveform.drawStaticWaveform(filePlayer.waveformPeaks.value, progress, fileVolume.value)
  }
})

onMounted(() => {
  if (import.meta.client) {
    fetchASRConfig()
  }
  enumerateDevices()
  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
  nextTick(async () => {
    await startMicCapture()
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
      <span class="panel-title">音频源</span>
    </div>

    <div class="panel-content">
      <!-- Active Source Indicator -->
      <div class="active-source-row">
        <span class="active-source-label">当前</span>
        <span class="active-source-value" :class="{ 'no-source': !props.activeSource }">
          {{ props.activeSource ? props.activeSource.toUpperCase() : '无' }}
        </span>
      </div>

      <!-- Source -->
      <div class="form-row">
        <label class="form-label">源</label>
        <div class="source-grid">
          <button class="source-btn" :class="{ active: source === 'mic' }" @click="source = 'mic'">麦克风</button>
          <button class="source-btn" :class="{ active: source === 'file' }" @click="source = 'file'">文件</button>
          <button class="source-btn" :class="{ active: source === 'stream' }" @click="source = 'stream'">流</button>
        </div>
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
          高级设置
        </button>
      </div>

      <div v-if="showAdvanced" class="advanced-settings">
        <div class="form-row">
          <label class="form-label">输出采样率 (Hz)</label>
          <select v-model.number="advancedSettings.targetSampleRate" class="form-input">
            <option :value="8000">8000</option>
            <option :value="16000">16000</option>
            <option :value="48000">48000</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">分块大小 (ms)</label>
          <select v-model.number="advancedSettings.chunkDurationMs" class="form-input">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </div>
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
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input type="checkbox" v-model="advancedSettings.echoCancellation" />
            <span>回声消除</span>
          </label>
        </div>
        <div v-if="source === 'mic'" class="form-row advanced-check-row">
          <label class="check-label">
            <input type="checkbox" v-model="advancedSettings.noiseSuppression" />
            <span>降噪</span>
          </label>
        </div>
      </div>

      <!-- Save -->
      <div class="action-row">
        <button class="action-btn start" @click="handleSave">
          保存
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

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.active-source-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border-left: 3px solid rgba(56, 189, 248, 0.4);
}

.active-source-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.7);
}

.active-source-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  font-weight: 600;
  color: #38bdf8;
  letter-spacing: 0.05em;
}

.active-source-value.no-source {
  color: rgba(148, 163, 184, 0.4);
}

.form-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.8);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.source-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.device-status {
  color: rgba(148, 163, 184, 0.6);
  font-size: 0.8rem;
}

.device-status.empty {
  color: rgba(248, 113, 113, 0.7);
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

.action-btn.start:hover {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.2));
  border-color: rgba(16, 185, 129, 0.6);
}
</style>
