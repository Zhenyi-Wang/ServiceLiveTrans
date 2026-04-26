<script setup lang="ts">
const props = defineProps<{
  isLoading: boolean
}>()

const emit = defineEmits<{
  start: [config: { provider: string; model: string }]
  stop: []
}>()

const asrState = ref<'idle' | 'starting' | 'running' | 'error'>('idle')
const serviceLoading = ref(false)

const serviceHealth = ref<{
  status: 'ok' | 'offline'
  available_providers?: string[]
}>({ status: 'offline' })

const provider = ref('gguf')

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

const isActive = computed(() => asrState.value === 'running' || asrState.value === 'starting')
const isIdle = computed(() => asrState.value === 'idle' || asrState.value === 'error')

const stateClass = computed(() => ({
  'state-idle': asrState.value === 'idle',
  'state-starting': asrState.value === 'starting',
  'state-running': asrState.value === 'running',
  'state-error': asrState.value === 'error',
}))

async function fetchStatus() {
  try {
    const res = await $fetch<{ state: string; bridgeStatus: string; provider: string | null; modelLoaded: boolean; source: string | null }>('/api/asr/status')
    asrState.value = res.state as typeof asrState.value
  } catch {
    // ignore
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

function handleStart() {
  emit('start', { provider: provider.value, model: '' })
}

function handleStop() {
  emit('stop')
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

onMounted(() => {
  fetchStatus()
  fetchServiceHealth()
  const statusInterval = setInterval(fetchStatus, 3000)
  const healthInterval = setInterval(fetchServiceHealth, 3000)
  onUnmounted(() => {
    clearInterval(statusInterval)
    clearInterval(healthInterval)
  })
})
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <rect x="9" y="9" width="6" height="6"/>
        </svg>
      </div>
      <span class="panel-title">ASR 状态</span>
    </div>

    <div class="status-grid">
      <div class="info-row">
        <span class="info-label">服务</span>
        <span class="info-value" :class="{ highlight: serviceHealth.status === 'ok' }">
          {{ serviceHealth.status === 'ok' ? '在线' : '离线' }}
        </span>
      </div>

      <div class="info-row">
        <span class="info-label">状态</span>
        <span class="info-value" :class="stateClass">
          {{ asrState.toUpperCase() }}
        </span>
      </div>

      <!-- Provider -->
      <div class="form-row">
        <label class="info-label">引擎</label>
        <div class="provider-grid">
          <button
            v-for="p in availableProviders"
            :key="p"
            class="provider-btn"
            :class="{ active: provider === p }"
            :disabled="isActive"
            @click="provider = p"
          >
            {{ p }}
          </button>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="action-row">
      <!-- Service offline: start service -->
      <button
        v-if="serviceHealth.status !== 'ok'"
        class="action-btn start"
        :disabled="serviceLoading"
        @click="startService"
      >
        {{ serviceLoading ? '正在启动服务...' : '启动服务' }}
      </button>

      <!-- Service online, ASR idle: start ASR -->
      <template v-else>
        <button
          v-if="isIdle"
          class="action-btn start"
          :disabled="isLoading"
          @click="handleStart"
        >
          开始识别
        </button>
        <button
          v-else
          class="action-btn stop"
          :disabled="asrState === 'starting'"
          @click="handleStop"
        >
          {{ asrState === 'starting' ? '启动中...' : '停止识别' }}
        </button>
        <button
          v-if="isIdle"
          class="service-stop-btn"
          :disabled="serviceLoading"
          @click="stopService"
        >
          停止服务
        </button>
      </template>
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
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.5), transparent);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.panel-icon {
  width: 36px; height: 36px;
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
  font-size: 0.8rem; font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.status-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border-left: 3px solid rgba(56, 189, 248, 0.3);
}

.info-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.7);
}

.info-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.85rem; font-weight: 500;
  color: #e2e8f0;
}

.info-value.highlight { color: #22d3ee; }

.state-idle { color: #94a3b8; }
.state-starting { color: #fbbf24; }
.state-running { color: #22d3ee; }
.state-error { color: #f87171; }

.loading-hint {
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.5);
  text-align: center;
  padding: 1rem;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

.action-row {
  margin-top: 1rem;
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

.service-stop-btn {
  width: 100%;
  padding: 0.5rem;
  margin-top: 0.5rem;
  border-radius: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: transparent;
  color: rgba(148, 163, 184, 0.5);
}

.service-stop-btn:hover:not(:disabled) {
  border-color: rgba(148, 163, 184, 0.4);
  color: #94a3b8;
}

.service-stop-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
