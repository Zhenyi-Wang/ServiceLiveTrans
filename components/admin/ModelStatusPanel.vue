<script setup lang="ts">
const modelStatus = ref<{
  bridgeStatus: string
  provider: string | null
  modelLoaded: boolean
} | null>(null)

async function fetchStatus() {
  try {
    const res = await $fetch('/api/asr/status')
    modelStatus.value = res as typeof modelStatus.value
  } catch {
    // ignore
  }
}

onMounted(() => {
  fetchStatus()
  const interval = setInterval(fetchStatus, 3000)
  onUnmounted(() => clearInterval(interval))
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
      <span class="panel-title">MODEL STATUS</span>
    </div>

    <div v-if="modelStatus" class="status-grid">
      <div class="info-row">
        <span class="info-label">BRIDGE</span>
        <span class="info-value" :class="{ highlight: modelStatus.bridgeStatus === 'connected' }">
          {{ modelStatus.bridgeStatus }}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">PROVIDER</span>
        <span class="info-value">{{ modelStatus.provider || '—' }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">MODEL</span>
        <span class="info-value" :class="{ highlight: modelStatus.modelLoaded }">
          {{ modelStatus.modelLoaded ? 'LOADED' : 'IDLE' }}
        </span>
      </div>
    </div>
    <div v-else class="loading-hint">Loading...</div>
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
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.6);
}

.info-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.75rem; font-weight: 500;
  color: #e2e8f0;
}

.info-value.highlight { color: #22d3ee; }

.loading-hint {
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.5);
  text-align: center;
  padding: 1rem;
}
</style>
