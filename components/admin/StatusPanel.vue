<script setup lang="ts">
interface StatusData {
  isRunning: boolean
  connectionCount: number
  subtitleCount: number
  config: {
    optimizationDelay: number
    delayRandomRange: number
  }
}

interface Props {
  status: StatusData | null
}

const props = defineProps<Props>()

const isRunning = computed(() => props.status?.isRunning ?? false)
const connectionCount = computed(() => props.status?.connectionCount ?? 0)
const subtitleCount = computed(() => props.status?.subtitleCount ?? 0)
const optimizationDelay = computed(() => props.status?.config?.optimizationDelay ?? 2000)
const delayRandomRange = computed(() => props.status?.config?.delayRandomRange ?? 1000)

// 状态指标
const metrics = computed(() => [
  {
    label: '模拟',
    value: isRunning.value ? '运行中' : '空闲',
    type: 'status' as const,
    active: isRunning.value
  },
  {
    label: '连接数',
    value: connectionCount.value.toString(),
    type: 'number' as const,
    icon: 'users'
  },
  {
    label: '字幕数',
    value: subtitleCount.value.toString(),
    type: 'number' as const,
    icon: 'text'
  },
  {
    label: '延迟',
    value: `${optimizationDelay.value}ms`,
    subValue: `±${delayRandomRange.value}ms`,
    type: 'timing' as const,
    icon: 'clock'
  }
])
</script>

<template>
  <div class="status-panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>
      </div>
      <div class="panel-title-group">
        <span class="panel-title">系统状态</span>
        <span class="panel-subtitle">实时指标</span>
      </div>
    </div>

    <div class="metrics-grid">
      <div
        v-for="(metric, index) in metrics"
        :key="metric.label"
        class="metric-card"
        :class="{ active: metric.active }"
        :style="{ animationDelay: `${index * 0.1}s` }"
      >
        <div class="metric-header">
          <span class="metric-label">{{ metric.label }}</span>
          <div class="metric-indicator" v-if="metric.type === 'status'" :class="{ active: metric.active }">
            <span class="indicator-ring"></span>
          </div>
        </div>

        <div class="metric-value-container">
          <span class="metric-value" :class="{ status: metric.type === 'status', active: metric.active }">
            {{ metric.value }}
          </span>
          <span v-if="metric.subValue" class="metric-sub-value">{{ metric.subValue }}</span>
        </div>

        <!-- Decorative elements -->
        <div class="metric-decoration">
          <div class="deco-line"></div>
          <div class="deco-line"></div>
          <div class="deco-line"></div>
        </div>
      </div>
    </div>

    <!-- Activity visualization -->
    <div class="activity-section">
      <div class="activity-header">
        <span class="activity-label">活动</span>
        <div class="activity-pulse" :class="{ active: isRunning }">
          <span class="pulse-dot"></span>
        </div>
      </div>

      <div class="activity-bars">
        <div
          v-for="i in 20"
          :key="i"
          class="bar"
          :class="{ animated: isRunning }"
          :style="{
            height: isRunning ? `${Math.random() * 60 + 20}%` : '20%',
            animationDelay: `${i * 0.05}s`
          }"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap');

.status-panel {
  position: relative;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  overflow: hidden;
}

.status-panel::before {
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
}

.panel-icon svg {
  width: 24px;
  height: 24px;
}

.panel-title-group {
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

/* Metrics grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.metric-card {
  position: relative;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
  animation: fade-in 0.5s ease forwards;
  opacity: 0;
}

@keyframes fade-in {
  to { opacity: 1; }
}

.metric-card:hover {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.05);
}

.metric-card.active {
  border-color: rgba(16, 185, 129, 0.4);
}

.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.metric-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.6);
}

.metric-indicator {
  width: 12px;
  height: 12px;
  position: relative;
}

.indicator-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border: 2px solid #475569;
  border-radius: 50%;
}

.metric-indicator.active .indicator-ring {
  border-color: #10b981;
  animation: pulse-ring 1.5s ease-in-out infinite;
}

@keyframes pulse-ring {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.5; }
}

.metric-value-container {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.metric-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: #e2e8f0;
}

.metric-value.status {
  font-size: 1rem;
  letter-spacing: 0.1em;
}

.metric-value.status.active {
  color: #10b981;
}

.metric-sub-value {
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.5);
}

/* Decoration lines */
.metric-decoration {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  display: flex;
  gap: 2px;
  opacity: 0.3;
}

.deco-line {
  flex: 1;
  background: #38bdf8;
}

.metric-card.active .deco-line {
  background: #10b981;
}

/* Activity section */
.activity-section {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  padding: 1rem;
}

.activity-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.activity-label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.6);
}

.activity-pulse {
  width: 10px;
  height: 10px;
  background: #475569;
  border-radius: 50%;
  transition: all 0.3s ease;
}

.activity-pulse.active {
  background: #10b981;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
}

.pulse-dot {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.activity-pulse.active .pulse-dot {
  animation: pulse-dot 1s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.5); opacity: 0.5; }
}

/* Activity bars */
.activity-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 40px;
}

.bar {
  flex: 1;
  background: rgba(56, 189, 248, 0.3);
  border-radius: 2px 2px 0 0;
  transition: height 0.3s ease;
}

.bar.animated {
  animation: bar-dance 0.8s ease-in-out infinite;
}

@keyframes bar-dance {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; background: rgba(16, 185, 129, 0.5); }
}
</style>
