<script setup lang="ts">
interface Props {
  isRunning: boolean
  isLoading?: boolean
  currentDelay?: number
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false,
  currentDelay: 2000
})

const emit = defineEmits<{
  start: [delay?: number]
  stop: []
  clear: []
}>()

// 延迟配置
const delayValue = ref(props.currentDelay)

// 监听 props 变化
watch(() => props.currentDelay, (newVal) => {
  delayValue.value = newVal
})

const handleStart = () => {
  emit('start', delayValue.value)
}

const handleStop = () => {
  emit('stop')
}

const handleClear = () => {
  emit('clear')
}

// 延迟预设选项
const delayPresets = [
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '3s', value: 3000 },
  { label: '5s', value: 5000 }
]

// 格式化延迟显示
const formattedDelay = computed(() => {
  const seconds = (delayValue.value / 1000).toFixed(1)
  return `${seconds}s`
})
</script>

<template>
  <div class="control-panel" :class="{ running: isRunning }">
    <!-- Panel glow effect -->
    <div class="panel-glow" v-if="isRunning"></div>

    <div class="panel-header">
      <div class="panel-icon" :class="{ active: isRunning }">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/>
        </svg>
      </div>
      <div class="panel-title-group">
        <span class="panel-title">模拟控制</span>
        <span class="panel-subtitle">广播引擎</span>
      </div>
      <div class="status-badge" :class="{ active: isRunning }">
        <span class="badge-dot"></span>
        <span class="badge-text">{{ isRunning ? '广播中' : '待机' }}</span>
      </div>
    </div>

    <!-- 延迟配置 -->
    <div class="delay-section">
      <div class="delay-header">
        <span class="delay-label">翻译延迟</span>
        <div class="delay-value-display">
          <span class="delay-value">{{ formattedDelay }}</span>
          <span class="delay-unit">±1s 随机</span>
        </div>
      </div>

      <div class="slider-container">
        <div class="slider-track">
          <input
            type="range"
            v-model.number="delayValue"
            min="500"
            max="10000"
            step="500"
            :disabled="isRunning"
            class="delay-slider"
          />
          <div class="slider-fill" :style="{ width: `${((delayValue - 500) / 9500) * 100}%` }"></div>
        </div>

        <div class="preset-buttons">
          <button
            v-for="preset in delayPresets"
            :key="preset.value"
            class="preset-btn"
            :class="{ active: delayValue === preset.value }"
            :disabled="isRunning"
            @click="delayValue = preset.value"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 控制按钮 -->
    <div class="control-buttons">
      <!-- 开始按钮 -->
      <button
        v-if="!isRunning"
        class="control-btn primary"
        :disabled="isLoading"
        @click="handleStart"
      >
        <div class="btn-content">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
          </svg>
          <span class="btn-text">开始广播</span>
        </div>
        <div class="btn-glow"></div>
      </button>

      <!-- 停止按钮 -->
      <button
        v-else
        class="control-btn danger"
        :disabled="isLoading"
        @click="handleStop"
      >
        <div class="btn-content">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
            <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>
          </svg>
          <span class="btn-text">停止广播</span>
        </div>
        <div class="btn-glow"></div>
      </button>

      <!-- 清空按钮 -->
      <button
        class="control-btn secondary"
        :disabled="isRunning || isLoading"
        @click="handleClear"
      >
        <div class="btn-content">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          <span class="btn-text">清空字幕</span>
        </div>
      </button>
    </div>

    <!-- Loading overlay -->
    <div class="loading-overlay" v-if="isLoading">
      <div class="loading-spinner"></div>
      <span class="loading-text">处理中</span>
    </div>
  </div>
</template>

<style scoped>
.control-panel {
  position: relative;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  overflow: hidden;
  transition: all 0.5s ease;
}

.control-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.5), transparent);
}

.control-panel.running {
  border-color: rgba(16, 185, 129, 0.4);
}

.control-panel.running::before {
  background: linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.7), transparent);
}

.panel-glow {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.1) 0%, transparent 50%);
  animation: rotate-glow 10s linear infinite;
  pointer-events: none;
}

@keyframes rotate-glow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.panel-icon {
  width: 48px;
  height: 48px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
  transition: all 0.3s ease;
}

.panel-icon svg {
  width: 24px;
  height: 24px;
}

.panel-icon.active {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.5);
  color: #10b981;
  animation: pulse-icon 1.5s ease-in-out infinite;
}

@keyframes pulse-icon {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.panel-title-group {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.panel-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #e2e8f0;
}

.panel-subtitle {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  color: rgba(148, 163, 184, 0.6);
  margin-top: 0.25rem;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(71, 85, 105, 0.3);
  border: 1px solid rgba(71, 85, 105, 0.5);
  border-radius: 20px;
  transition: all 0.3s ease;
}

.status-badge.active {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.5);
}

.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #64748b;
}

.status-badge.active .badge-dot {
  background: #ef4444;
  animation: blink 1s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.badge-text {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #94a3b8;
}

.status-badge.active .badge-text {
  color: #10b981;
}

/* Delay section */
.delay-section {
  margin-bottom: 1.5rem;
  padding: 1.25rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.1);
}

.delay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.delay-label {
  font-size: 0.7rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.6);
}

.delay-value-display {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.delay-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: #38bdf8;
}

.delay-unit {
  font-size: 0.65rem;
  color: rgba(148, 163, 184, 0.5);
}

.slider-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.slider-track {
  position: relative;
  height: 8px;
  background: rgba(30, 41, 59, 0.8);
  border-radius: 4px;
  overflow: hidden;
}

.delay-slider {
  position: absolute;
  width: 100%;
  height: 100%;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  z-index: 2;
}

.delay-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  background: #38bdf8;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  transition: all 0.2s ease;
}

.delay-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 15px rgba(56, 189, 248, 0.8);
}

.delay-slider:disabled::-webkit-slider-thumb {
  background: #475569;
  box-shadow: none;
  cursor: not-allowed;
}

.slider-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.6), rgba(34, 211, 238, 0.6));
  pointer-events: none;
}

.preset-buttons {
  display: flex;
  gap: 0.5rem;
}

.preset-btn {
  flex: 1;
  padding: 0.6rem;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 8px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
}

.preset-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: #38bdf8;
  color: #38bdf8;
}

.preset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Control buttons */
.control-buttons {
  display: flex;
  gap: 1rem;
}

.control-btn {
  flex: 1;
  position: relative;
  padding: 1rem;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 12px;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.3s ease;
}

.control-btn.primary {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(6, 95, 70, 0.3) 100%);
  border-color: rgba(16, 185, 129, 0.5);
}

.control-btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(6, 95, 70, 0.4) 100%);
  border-color: rgba(16, 185, 129, 0.8);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.2);
}

.control-btn.danger {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(127, 29, 29, 0.3) 100%);
  border-color: rgba(239, 68, 68, 0.5);
}

.control-btn.danger:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(127, 29, 29, 0.4) 100%);
  border-color: rgba(239, 68, 68, 0.8);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(239, 68, 68, 0.2);
}

.control-btn.secondary {
  background: rgba(30, 41, 59, 0.6);
}

.control-btn.secondary:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.5);
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.btn-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  position: relative;
  z-index: 1;
}

.btn-icon {
  width: 20px;
  height: 20px;
}

.control-btn.primary .btn-icon {
  color: #10b981;
}

.control-btn.danger .btn-icon {
  color: #ef4444;
}

.control-btn.secondary .btn-icon {
  color: #94a3b8;
}

.btn-text {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #e2e8f0;
}

.control-btn.primary .btn-text {
  color: #10b981;
}

.control-btn.danger .btn-text {
  color: #ef4444;
}

.btn-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.3s ease;
}

.control-btn:hover:not(:disabled) .btn-glow {
  transform: translate(-50%, -50%) scale(1.5);
}

/* Loading overlay */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(10, 14, 23, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  z-index: 10;
  border-radius: 16px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(56, 189, 248, 0.2);
  border-top-color: #38bdf8;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: #38bdf8;
  animation: pulse-text 1s ease-in-out infinite;
}

@keyframes pulse-text {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
