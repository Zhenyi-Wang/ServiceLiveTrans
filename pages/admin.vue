<script setup lang="ts">
definePageMeta({
  layout: false
})

// 状态
const isRunning = ref(false)
const isLoading = ref(false)

// 转录状态（从 TranscriptionControlPanel 获取）
const transcriptionConnectionCount = ref(0)
const transcriptionSubtitleCount = ref(0)
const transcriptionState = ref<string>('idle')

function handleTranscriptionStatusChange(state: string) {
  transcriptionState.value = state
}

function handleCountsUpdate(connectionCount: number, subtitleCount: number) {
  transcriptionConnectionCount.value = connectionCount
  transcriptionSubtitleCount.value = subtitleCount
}

// WS 测试相关
const wsMessageType = ref<string>('current')
const wsSendLoading = ref(false)
const wsSendLog = ref<Array<{ time: string; type: string; success: boolean; content: string }>>([])

// 表单字段
const formFields = ref({
  text: '',           // 中文文本 (current/confirmed)
  subtitleId: '',      // 字幕 ID (confirmed)
  optimizedText: '',   // 优化文本 (confirmed)
  enText: '',         // 英文翻译 (current/confirmed)
  version: 0,         // 中文版本号 (current)
  enVersion: 0        // 英文版本号 (current)
})

const wsMessageTypes = [
  { value: 'current', label: 'current', desc: '当前输入' },
  { value: 'confirmed', label: 'confirmed', desc: '确认字幕' },
  { value: 'clear', label: 'clear', desc: '清空字幕' }
]

const formatTime = (date: Date) => {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

const getMessageData = () => {
  switch (wsMessageType.value) {
    case 'current':
      return {
        text: formFields.value.text,
        enText: formFields.value.enText,
        version: formFields.value.version || 1,
        enVersion: formFields.value.enVersion || 0
      }
    case 'confirmed':
      return {
        id: formFields.value.subtitleId || crypto.randomUUID(),
        text: formFields.value.text,
        optimizedText: formFields.value.optimizedText || formFields.value.text,
        enText: formFields.value.enText
      }
    case 'clear':
      return null
    default:
      return null
  }
}

const handleSendWsMessage = async () => {
  wsSendLoading.value = true
  const time = formatTime(new Date())
  const data = getMessageData()

  try {
    await $fetch('/api/ws/send', {
      method: 'POST',
      body: {
        type: wsMessageType.value,
        data
      }
    })
    wsSendLog.value.unshift({
      time,
      type: wsMessageType.value,
      success: true,
      content: data ? JSON.stringify(data).substring(0, 60) : '(no data)'
    })
    // 清空表单
    formFields.value = { text: '', subtitleId: '', optimizedText: '', enText: '', version: 0, enVersion: 0 }
  } catch (error: any) {
    wsSendLog.value.unshift({
      time,
      type: wsMessageType.value,
      success: false,
      content: error.message || '发送失败'
    })
  } finally {
    wsSendLoading.value = false
  }
}

// 获取状态
const fetchStatus = async () => {
  try {
    await $fetch('/api/status')
  } catch (error) {
    console.error('Failed to fetch status:', error)
  }
}

// 开始模拟
const handleStart = async (delay?: number) => {
  isLoading.value = true
  try {
    await $fetch('/api/simulate/start', {
      method: 'POST',
      body: delay ? { delay } : undefined
    })
    isRunning.value = true
    await fetchStatus()
  } catch (error) {
    console.error('Failed to start simulation:', error)
  } finally {
    isLoading.value = false
  }
}

// 停止模拟
const handleStop = async () => {
  isLoading.value = true
  try {
    await $fetch('/api/simulate/stop', { method: 'POST' })
    isRunning.value = false
    await fetchStatus()
  } catch (error) {
    console.error('Failed to stop simulation:', error)
  } finally {
    isLoading.value = false
  }
}

// 清空字幕
const handleClear = async () => {
  isLoading.value = true
  try {
    await $fetch('/api/clear', { method: 'POST' })
    await fetchStatus()
  } catch (error) {
    console.error('Failed to clear subtitles:', error)
  } finally {
    isLoading.value = false
  }
}

// 当前延迟值

// 状态更新（模拟器操作后手动调用）
const devToolsOpen = ref(false)

// 当前延迟值
const currentDelay = ref(2000)

// 当前时间
const currentTime = ref(new Date())
const formattedTime = computed(() => {
  const t = currentTime.value
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`
})

// 时间显示
let timeInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchStatus()
  timeInterval = setInterval(() => {
    currentTime.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (timeInterval) {
    clearInterval(timeInterval)
  }
})
</script>

<template>
  <div class="control-room">
    <!-- Scan lines overlay -->
    <div class="scan-lines"></div>

    <!-- 背景网格 -->
    <div class="grid-bg"></div>

    <!-- 顶部导航 -->
    <header class="control-header">
      <div class="header-content">
        <div class="logo-section">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </div>
          <div class="logo-text">
            <span class="logo-title">转录器</span>
            <span class="logo-subtitle">控制中心</span>
          </div>
        </div>

        <div class="header-right">
          <div class="time-display">
            <span class="time-label">系统时间</span>
            <span class="time-value"><ClientOnly>{{ formattedTime }}</ClientOnly></span>
          </div>

          <NuxtLink to="/" class="nav-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="nav-icon">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>返回前台</span>
          </NuxtLink>
        </div>
      </div>

      <!-- Status bar -->
      <div class="status-bar">
        <div class="status-item">
          <span class="status-dot" :class="{ active: isRunning }"></span>
          <span class="status-text">{{ isRunning ? '广播中' : '待机' }}</span>
        </div>
        <div class="status-divider"></div>
        <div class="status-item">
          <span class="status-label">连接</span>
          <span class="status-value">{{ transcriptionConnectionCount }}</span>
        </div>
        <div class="status-divider"></div>
        <div class="status-item">
          <span class="status-label">字幕</span>
          <span class="status-value">{{ transcriptionSubtitleCount }}</span>
        </div>
      </div>
    </header>

    <!-- 主内容 -->
    <main class="control-main">
      <div class="control-grid">
        <!-- 转录控制面板 -->
        <AdminTranscriptionControlPanel
          :connection-count="transcriptionConnectionCount"
          :subtitle-count="transcriptionSubtitleCount"
          @status-change="handleTranscriptionStatusChange"
          @counts-update="handleCountsUpdate"
        />

        <!-- 开发测试工具（折叠） -->
        <div class="dev-tools-section">
          <button class="dev-tools-toggle" @click="devToolsOpen = !devToolsOpen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toggle-icon">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
            <span class="toggle-title">开发工具</span>
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              class="toggle-arrow" :class="{ open: devToolsOpen }"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <div class="dev-tools-content" v-show="devToolsOpen">
            <!-- 模拟控制 -->
            <AdminControlPanel
              :is-running="isRunning"
              :is-loading="isLoading"
              :current-delay="currentDelay"
              @start="handleStart"
              @stop="handleStop"
              @clear="handleClear"
            />

            <!-- WS 测试面板 -->
            <div class="ws-test-panel">
              <div class="panel-header">
                <div class="panel-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                  </svg>
                </div>
                <span class="panel-title">WS 事件测试</span>
              </div>

              <div class="ws-test-form">
                <!-- 消息类型选择 -->
                <div class="form-row">
                  <label class="form-label">消息类型</label>
                  <div class="type-grid">
                    <button
                      v-for="msg in wsMessageTypes"
                      :key="msg.value"
                      class="type-btn"
                      :class="{ active: wsMessageType === msg.value }"
                      @click="wsMessageType = msg.value"
                    >
                      <span class="type-name">{{ msg.label }}</span>
                      <span class="type-desc">{{ msg.desc }}</span>
                    </button>
                  </div>
                </div>

                <!-- 动态表单字段 -->
                <div class="form-fields" v-if="wsMessageType !== 'clear'">
                  <!-- current 字段 -->
                  <template v-if="wsMessageType === 'current'">
                    <div class="form-row">
                      <label class="form-label">中文文本</label>
                      <input
                        v-model="formFields.text"
                        type="text"
                        class="form-input"
                        placeholder="输入当前中文..."
                      />
                    </div>

                    <div class="form-row">
                      <label class="form-label">英文翻译</label>
                      <input
                        v-model="formFields.enText"
                        type="text"
                        class="form-input"
                        placeholder="输入英文翻译..."
                      />
                    </div>

                    <div class="form-row">
                      <label class="form-label">中文版本号</label>
                      <input
                        v-model.number="formFields.version"
                        type="number"
                        class="form-input"
                        placeholder="输入版本号..."
                      />
                    </div>

                    <div class="form-row">
                      <label class="form-label">英文版本号</label>
                      <input
                        v-model.number="formFields.enVersion"
                        type="number"
                        class="form-input"
                        placeholder="输入英文版本号..."
                      />
                    </div>
                  </template>

                  <!-- confirmed 字段 -->
                  <template v-if="wsMessageType === 'confirmed'">
                    <div class="form-row">
                      <label class="form-label">中文文本</label>
                      <input
                        v-model="formFields.text"
                        type="text"
                        class="form-input"
                        placeholder="输入确认的中文..."
                      />
                    </div>

                    <div class="form-row">
                      <label class="form-label">优化后的中文</label>
                      <input
                        v-model="formFields.optimizedText"
                        type="text"
                        class="form-input"
                        placeholder="输入优化后的中文（可选）..."
                      />
                    </div>

                    <div class="form-row">
                      <label class="form-label">英文翻译</label>
                      <input
                        v-model="formFields.enText"
                        type="text"
                        class="form-input"
                        placeholder="输入英文翻译..."
                      />
                    </div>

                    <div class="form-row">
                      <label class="form-label">字幕 ID（可选）</label>
                      <input
                        v-model="formFields.subtitleId"
                        type="text"
                        class="form-input"
                        placeholder="留空自动生成"
                      />
                    </div>
                  </template>
                </div>

                <!-- clear 提示 -->
                <div class="clear-hint" v-if="wsMessageType === 'clear'">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>点击发送将清空所有字幕</span>
                </div>

                <button
                  class="send-btn"
                  :disabled="wsSendLoading"
                  @click="handleSendWsMessage"
                >
                  <svg v-if="wsSendLoading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                  <span>发送</span>
                </button>
              </div>

              <div class="ws-log" v-if="wsSendLog.length > 0">
                <div class="log-header">发送日志</div>
                <div class="log-list">
                  <div
                    v-for="(log, index) in wsSendLog.slice(0, 10)"
                    :key="index"
                    class="log-item"
                    :class="{ success: log.success, error: !log.success }"
                  >
                    <span class="log-time">{{ log.time }}</span>
                    <span class="log-type">[{{ log.type }}]</span>
                    <span class="log-content">{{ log.content }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>

    <!-- 底部 -->
    <footer class="control-footer">
      <div class="footer-content">
        <span class="footer-text">转录器 v1.0 // 实时转录系统</span>
        <div class="footer-indicator">
          <span class="indicator-dot"></span>
          <span class="indicator-dot"></span>
          <span class="indicator-dot active"></span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap');
</style>

<style scoped>

.control-room {
  min-height: 100vh;
  background: linear-gradient(135deg, #0a0e17 0%, #0d1320 50%, #0a0e17 100%);
  color: #e0e7ff;
  font-family: 'JetBrains Mono', monospace;
  position: relative;
  overflow-x: hidden;
}

/* Scan lines effect */
.scan-lines {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1000;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.1) 2px,
    rgba(0, 0, 0, 0.1) 4px
  );
}

/* Grid background */
.grid-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
}

/* Header */
.control-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(15, 23, 42, 0.95) 100%);
  border-bottom: 1px solid rgba(56, 189, 248, 0.2);
  backdrop-filter: blur(12px);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.logo-section {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo-icon {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(34, 211, 238, 0.2) 100%);
  border: 1px solid rgba(56, 189, 248, 0.4);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #38bdf8;
  animation: pulse-glow 2s ease-in-out infinite;
}

.logo-icon svg {
  width: 28px;
  height: 28px;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 20px rgba(56, 189, 248, 0.2); }
  50% { box-shadow: 0 0 30px rgba(56, 189, 248, 0.4); }
}

.logo-text {
  display: flex;
  flex-direction: column;
}

.logo-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  background: linear-gradient(90deg, #38bdf8 0%, #22d3ee 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.logo-subtitle {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.8);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.time-display {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.time-label {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  color: rgba(148, 163, 184, 0.7);
}

.time-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 1.25rem;
  font-weight: 600;
  color: #22d3ee;
  letter-spacing: 0.1em;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  color: #94a3b8;
  font-size: 0.8rem;
  letter-spacing: 0.1em;
  text-decoration: none;
  transition: all 0.3s ease;
}

.nav-link:hover {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.6);
  color: #38bdf8;
}

.nav-icon {
  width: 18px;
  height: 18px;
}

/* Status bar */
.status-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 2rem;
  background: rgba(0, 0, 0, 0.3);
  border-top: 1px solid rgba(56, 189, 248, 0.1);
}

.status-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #475569;
  border: 2px solid rgba(71, 85, 105, 0.5);
  transition: all 0.3s ease;
}

.status-dot.active {
  background: #10b981;
  border-color: rgba(16, 185, 129, 0.5);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.6);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}

.status-text {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.status-divider {
  width: 1px;
  height: 20px;
  background: rgba(56, 189, 248, 0.2);
}

.status-label {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  color: rgba(148, 163, 184, 0.7);
}

.status-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: #38bdf8;
}

/* Main content */
.control-main {
  position: relative;
  z-index: 1;
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.control-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
}

@media (max-width: 1024px) {
  .control-grid {
    grid-template-columns: 1fr;
  }
}

/* Panel common styles */
.ws-test-panel {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.6) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  position: relative;
  overflow: hidden;
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

/* Dev Tools Section */
.dev-tools-section {
  grid-column: span 2;
}

@media (max-width: 1024px) {
  .dev-tools-section {
    grid-column: span 1;
  }
}

.dev-tools-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 1rem 1.25rem;
  background: rgba(15, 23, 42, 0.6);
  border: 1px dashed rgba(56, 189, 248, 0.25);
  border-radius: 12px;
  color: #64748b;
  cursor: pointer;
  transition: all 0.3s ease;
}

.dev-tools-toggle:hover {
  background: rgba(15, 23, 42, 0.8);
  border-color: rgba(56, 189, 248, 0.4);
  color: #94a3b8;
}

.toggle-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.toggle-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  flex: 1;
}

.toggle-arrow {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  transition: transform 0.3s ease;
}

.toggle-arrow.open {
  transform: rotate(180deg);
}

.dev-tools-content {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
}

@media (max-width: 1024px) {
  .dev-tools-content {
    grid-template-columns: 1fr;
  }
}

/* WS Test Panel */

.ws-test-form {
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
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.8);
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

/* Type grid buttons */
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

@media (max-width: 768px) {
  .type-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 0.5rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.type-btn:hover {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
}

.type-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
}

.type-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  color: #e2e8f0;
  letter-spacing: 0.05em;
}

.type-desc {
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.7);
}

.type-btn.active .type-name {
  color: #38bdf8;
}

/* Clear hint */
.clear-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.5rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #f87171;
  font-size: 0.85rem;
}

.clear-hint svg {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(34, 211, 238, 0.2) 100%);
  border: 1px solid rgba(56, 189, 248, 0.4);
  border-radius: 8px;
  color: #38bdf8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.3s ease;
}

.send-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.3) 0%, rgba(34, 211, 238, 0.3) 100%);
  border-color: rgba(56, 189, 248, 0.6);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(56, 189, 248, 0.2);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-btn svg {
  width: 18px;
  height: 18px;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ws-log {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(56, 189, 248, 0.1);
}

.log-header {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.7);
  margin-bottom: 0.75rem;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 200px;
  overflow-y: auto;
}

.log-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  border-left: 3px solid;
  font-size: 0.75rem;
}

.log-item.success {
  border-left-color: #10b981;
}

.log-item.error {
  border-left-color: #ef4444;
}

.log-time {
  color: rgba(148, 163, 184, 0.5);
  font-size: 0.7rem;
  flex-shrink: 0;
}

.log-type {
  color: #38bdf8;
  font-weight: 600;
  flex-shrink: 0;
}

.log-content {
  color: #94a3b8;
  word-break: break-all;
}

/* Footer */
.control-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: rgba(10, 14, 23, 0.95);
  border-top: 1px solid rgba(56, 189, 248, 0.2);
  backdrop-filter: blur(8px);
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.footer-text {
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  color: rgba(148, 163, 184, 0.6);
}

.footer-indicator {
  display: flex;
  gap: 0.5rem;
}

.indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(71, 85, 105, 0.5);
}

.indicator-dot.active {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}

/* Add padding at bottom to prevent footer overlap */
.control-main {
  padding-bottom: 5rem;
}
</style>
