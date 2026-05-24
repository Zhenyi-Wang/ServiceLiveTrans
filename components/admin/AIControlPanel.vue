<script setup lang="ts">
const baseUrl = ref('')
const apiKey = ref('')
const modelName = ref('')
const polishEnabled = ref(false)
const translationEnabled = ref(false)
const loading = ref(false)
const saving = ref(false)
const saveSuccess = ref(false)
const apiKeyHint = ref('')
const error = ref('')

const isAIActive = computed(() => polishEnabled.value || translationEnabled.value)

const statusText = computed(() => {
  if (!polishEnabled.value && !translationEnabled.value) return 'AI 未启用'
  const parts: string[] = []
  if (polishEnabled.value) parts.push('润色')
  if (translationEnabled.value) parts.push('翻译')
  return `AI 已启用: ${parts.join(' + ')}`
})

async function fetchConfig() {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<{
      baseUrl: string
      apiKey: string
      modelName: string
      polishEnabled: boolean
      translationEnabled: boolean
      apiKeyConfigured: boolean
      apiKeyHint: string
    }>('/api/ai/config')
    baseUrl.value = data.baseUrl
    modelName.value = data.modelName
    polishEnabled.value = data.polishEnabled
    translationEnabled.value = data.translationEnabled
    apiKeyHint.value = data.apiKeyHint
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载配置失败'
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  saveSuccess.value = false
  error.value = ''
  try {
    const body: Record<string, string | boolean> = {
      baseUrl: baseUrl.value,
      modelName: modelName.value,
      polishEnabled: polishEnabled.value,
      translationEnabled: translationEnabled.value,
    }
    if (apiKey.value) body.apiKey = apiKey.value

    const data = await $fetch<{
      baseUrl: string
      modelName: string
      polishEnabled: boolean
      translationEnabled: boolean
      apiKeyConfigured: boolean
      apiKeyHint: string
    }>('/api/ai/config', {
      method: 'POST',
      body,
    })
    baseUrl.value = data.baseUrl
    modelName.value = data.modelName
    polishEnabled.value = data.polishEnabled
    translationEnabled.value = data.translationEnabled
    apiKeyHint.value = data.apiKeyHint
    apiKey.value = ''
    saveSuccess.value = true
    setTimeout(() => {
      saveSuccess.value = false
    }, 2000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(fetchConfig)
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Z" />
          <path d="M16 14H8a6 6 0 0 0-6 6v2h20v-2a6 6 0 0 0-6-6Z" />
        </svg>
      </div>
      <span class="panel-title">AI CONTROL</span>
    </div>

    <div class="panel-content">
      <!-- Loading -->
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <span>加载配置...</span>
      </div>

      <template v-else>
        <!-- Error -->
        <div v-if="error" class="status-message error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{{ error }}</span>
        </div>

        <!-- Status -->
        <div class="status-block">
          <div class="status-main-row">
            <div class="status-main-left">
              <span class="status-dot" :class="{ active: isAIActive }"></span>
              <span class="status-state-text" :class="isAIActive ? 'state-running' : 'state-idle'">
                {{ statusText }}
              </span>
            </div>
            <span v-if="apiKeyHint" class="api-key-hint">{{ apiKeyHint }}</span>
          </div>
        </div>

        <!-- API -->
        <div class="section-label">
          <span class="section-text">API</span>
        </div>

        <div class="form-row">
          <label class="form-label"><span>Base URL</span></label>
          <input
            v-model="baseUrl"
            type="text"
            class="form-input"
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div class="form-row">
          <label class="form-label">
            <span>API Key</span>
            <span v-if="apiKeyHint" class="label-hint">已配置 (留空保持不变)</span>
          </label>
          <input
            v-model="apiKey"
            type="password"
            class="form-input"
            placeholder="留空保持已保存的 Key"
          />
        </div>

        <!-- Model -->
        <div class="section-label">
          <span class="section-text">MODEL</span>
        </div>

        <div class="form-row">
          <label class="form-label"><span>模型名称</span></label>
          <input
            v-model="modelName"
            type="text"
            class="form-input"
            placeholder="留空使用环境变量 AI_MODEL_NAME"
          />
        </div>

        <!-- Features -->
        <div class="section-label">
          <span class="section-text">FEATURES</span>
        </div>

        <div class="toggle-grid">
          <div class="toggle-item">
            <label class="toggle-switch">
              <input v-model="polishEnabled" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
            <div class="toggle-info">
              <span class="toggle-name">润色</span>
              <span class="toggle-desc">优化文本表达</span>
            </div>
          </div>

          <div class="toggle-item">
            <label class="toggle-switch">
              <input v-model="translationEnabled" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
            <div class="toggle-info">
              <span class="toggle-name">翻译</span>
              <span class="toggle-desc">翻译为英文</span>
            </div>
          </div>
        </div>

        <!-- Save Button -->
        <button class="save-btn" :disabled="saving" @click="saveConfig">
          <svg
            v-if="saving"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="spin-icon"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span>{{ saveSuccess ? '已保存' : '保存配置' }}</span>
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
  height: fit-content;
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

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* ── Loading ── */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  color: #94a3b8;
  font-size: 0.8rem;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(56, 189, 248, 0.3);
  border-top-color: #38bdf8;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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

.status-message svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
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
  background: #475569;
  flex-shrink: 0;
  transition: all 0.3s;
}

.status-dot.active {
  background: #10b981;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.6);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.1);
  }
}

.status-state-text {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.state-idle {
  color: #94a3b8;
}

.state-running {
  color: #22d3ee;
}

.api-key-hint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: rgba(56, 189, 248, 0.6);
  letter-spacing: 0.05em;
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

/* ── Form ── */
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

.label-hint {
  font-size: 0.65rem;
  color: rgba(56, 189, 248, 0.5);
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
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1);
}

.form-input::placeholder {
  color: rgba(148, 163, 184, 0.4);
}

/* ── Toggle grid ── */
.toggle-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.toggle-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.toggle-item:hover {
  border-color: rgba(56, 189, 248, 0.3);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: rgba(71, 85, 105, 0.6);
  border: 1px solid rgba(71, 85, 105, 0.4);
  border-radius: 22px;
  transition: all 0.3s ease;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background: #94a3b8;
  border-radius: 50%;
  transition: all 0.3s ease;
}

.toggle-switch input:checked + .toggle-slider {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(18px);
  background: #38bdf8;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.toggle-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 600;
  color: #e2e8f0;
  letter-spacing: 0.05em;
}

.toggle-desc {
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.6);
}

/* ── Save button ── */
.save-btn {
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

.save-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.3) 0%, rgba(34, 211, 238, 0.3) 100%);
  border-color: rgba(56, 189, 248, 0.6);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(56, 189, 248, 0.2);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-btn svg {
  width: 18px;
  height: 18px;
}

.spin-icon {
  animation: spin 1s linear infinite;
}
</style>
