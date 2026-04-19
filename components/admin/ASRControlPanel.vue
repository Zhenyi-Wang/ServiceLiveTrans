<script setup lang="ts">
const props = defineProps<{
  isRunning: boolean
  isLoading: boolean
}>()

const emit = defineEmits<{
  start: [config: { provider: string; model: string; source: string; streamUrl?: string }]
  stop: []
}>()

const provider = ref('whisper')
const source = ref('mic')
const streamUrl = ref('')
const availableProviders = ['whisper', 'funasr']

const handleStart = () => {
  emit('start', {
    provider: provider.value,
    model: '',
    source: source.value,
    streamUrl: source.value === 'stream' ? streamUrl.value : undefined
  })
}
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
      <span
        v-if="isRunning"
        class="status-badge active"
      >LIVE</span>
    </div>

    <div class="panel-content">
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
            :class="{ active: source === 'stream' }"
            :disabled="isRunning"
            @click="source = 'stream'"
          >Stream URL</button>
        </div>
      </div>

      <div v-if="source === 'stream'" class="form-row">
        <label class="form-label">STREAM URL</label>
        <input
          v-model="streamUrl"
          type="text"
          class="form-input"
          placeholder="rtmp://... or https://..."
          :disabled="isRunning"
        />
      </div>

      <div class="action-row">
        <button
          v-if="!isRunning"
          class="action-btn start"
          :disabled="isLoading || (source === 'stream' && !streamUrl)"
          @click="handleStart"
        >
          START ASR
        </button>
        <button
          v-else
          class="action-btn stop"
          :disabled="isLoading"
          @click="emit('stop')"
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
