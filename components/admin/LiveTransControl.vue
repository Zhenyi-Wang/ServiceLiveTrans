<script setup lang="ts">
import type { LiveTransState } from '~/types/websocket'

const props = withDefaults(defineProps<{
  isRunning: boolean
  isLoading: boolean
}>(), {
  isRunning: false,
  isLoading: false
})

const emit = defineEmits<{
  start: []
  stop: []
}>()

const status = ref<{
  state: LiveTransState
  sourceType: string | null
  reconnectCount: number
  uptime: number
} | null>(null)

const useMockAI = ref(true)

const statusLabel = computed(() => {
  const s = status.value?.state ?? 'idle'
  const labels: Record<string, string> = {
    idle: '空闲',
    connecting: '连接中...',
    running: '运行中',
    reconnecting: `重连中 (#${status.value?.reconnectCount ?? 0})`
  }
  return labels[s] ?? s
})

const statusColor = computed(() => {
  const s = status.value?.state ?? 'idle'
  const colors: Record<string, string> = {
    idle: '#64748b',
    connecting: '#f59e0b',
    running: '#10b981',
    reconnecting: '#f97316'
  }
  return colors[s] ?? '#64748b'
})

const uptimeFormatted = computed(() => {
  const seconds = status.value?.uptime ?? 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const canStart = computed(() => !props.isLoading && !props.isRunning)
const canStop = computed(() => !props.isLoading && props.isRunning)

const fetchStatus = async () => {
  try {
    status.value = await $fetch('/api/live/status') as typeof status.value
  } catch {
    // ignore
  }
}

const fetchAIConfig = async () => {
  try {
    const res = await $fetch('/api/live/ai-config') as { useMockAI: boolean }
    useMockAI.value = res.useMockAI
  } catch {
    // ignore
  }
}

const handleStart = async () => {
  emit('start')
}

const handleStop = async () => {
  emit('stop')
}

const handleToggleMockAI = async () => {
  const newVal = !useMockAI.value
  try {
    const res = await $fetch('/api/live/ai-config', {
      method: 'POST',
      body: { useMockAI: newVal }
    }) as { useMockAI: boolean }
    useMockAI.value = res.useMockAI
  } catch {
    // ignore
  }
}

let interval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchStatus()
  fetchAIConfig()
  interval = setInterval(fetchStatus, 3000)
})

onUnmounted(() => {
  if (interval) clearInterval(interval)
})
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </div>
      <span class="panel-title">LIVE TRANS</span>
      <span
        v-if="isRunning"
        class="status-badge active"
      >LIVE</span>
    </div>

    <div class="panel-content">
      <!-- 状态信息 -->
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">STATUS</span>
          <span class="info-value" :style="{ color: statusColor }">
            <span class="status-dot" :style="{ background: statusColor }"></span>
            {{ statusLabel }}
          </span>
        </div>
        <div class="info-item">
          <span class="info-label">UPTIME</span>
          <span class="info-value">{{ uptimeFormatted }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">RECONNECT</span>
          <span class="info-value">{{ status?.reconnectCount ?? 0 }}</span>
        </div>
      </div>

      <!-- Mock AI 开关 -->
      <div class="form-row">
        <label class="form-label">MOCK AI</label>
        <button
          class="toggle-btn"
          :class="{ active: useMockAI }"
          @click="handleToggleMockAI"
        >
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
          <span class="toggle-text">{{ useMockAI ? 'ON' : 'OFF' }}</span>
        </button>
      </div>

      <!-- 操作按钮 -->
      <div class="action-row">
        <button
          v-if="!isRunning"
          class="action-btn start"
          :disabled="!canStart"
          @click="handleStart"
        >
          START LIVE
        </button>
        <button
          v-else
          class="action-btn stop"
          :disabled="!canStop"
          @click="handleStop"
        >
          STOP
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

.info-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.info-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.6);
}

.info-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 500;
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.form-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.form-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.7);
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: rgba(71, 85, 105, 0.5);
  border-radius: 10px;
  position: relative;
  transition: background 0.3s ease;
}

.toggle-btn.active .toggle-track {
  background: rgba(56, 189, 248, 0.5);
}

.toggle-thumb {
  width: 16px;
  height: 16px;
  background: #94a3b8;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: all 0.3s ease;
}

.toggle-btn.active .toggle-thumb {
  left: 18px;
  background: #38bdf8;
}

.toggle-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #94a3b8;
}

.toggle-btn.active .toggle-text {
  color: #38bdf8;
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

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
</style>
