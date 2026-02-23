<script setup lang="ts">
interface Props {
  show: boolean
  isDark: boolean
  configAutoScroll: boolean
  configSyncScroll: boolean
  configParagraphLength: number
  configChineseFontSize: number
  configEnglishFontSize: number
}

defineProps<Props>()

defineEmits<{
  close: []
  toggleDark: []
  toggleAutoScroll: []
  toggleSyncScroll: []
  scrollToBottom: []
  'update:configParagraphLength': [value: number]
  'update:configChineseFontSize': [value: number]
  'update:configEnglishFontSize': [value: number]
}>()

const paragraphLengthOptions = [50, 100, 150, 200, 250, 350]
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="menu-overlay"
        @click="$emit('close')"
      >
        <Transition name="slide">
          <div
            v-if="show"
            class="menu-panel"
            @click.stop
          >
            <!-- 头部 -->
            <div class="menu-header">
              <h3>设置 | Settings</h3>
              <button
                class="menu-close-btn"
                aria-label="关闭设置"
                @click="$emit('close')"
              >
                <UIcon name="i-heroicons-x-mark" class="w-6 h-6" />
              </button>
            </div>

            <div class="menu-content">
              <!-- 显示设置 -->
              <div class="menu-section">
                <h4>显示设置 | Display</h4>

                <!-- 主题 -->
                <div class="menu-item" @click="$emit('toggleDark')">
                  <div class="item-info">
                    <span class="item-icon">
                      <UIcon :name="isDark ? 'i-heroicons-moon' : 'i-heroicons-sun'" class="w-5 h-5" />
                    </span>
                    <span class="item-label">主题 | Theme</span>
                  </div>
                  <div class="theme-toggle-btn">
                    <UIcon :name="isDark ? 'i-heroicons-moon' : 'i-heroicons-sun'" class="w-6 h-6" />
                  </div>
                </div>

                <!-- 自动滚动 -->
                <div class="menu-item">
                  <div class="item-info">
                    <span class="item-icon">
                      <UIcon name="i-heroicons-arrow-down" class="w-5 h-5" />
                    </span>
                    <span class="item-label">自动滚动 | Auto Scroll</span>
                  </div>
                  <label class="switch">
                    <input
                      type="checkbox"
                      :checked="configAutoScroll"
                      @change="$emit('toggleAutoScroll'); configAutoScroll && $emit('scrollToBottom')"
                    >
                    <span class="slider"></span>
                  </label>
                </div>

                <!-- 联动滚动 -->
                <div class="menu-item">
                  <div class="item-info">
                    <span class="item-icon">
                      <UIcon name="i-heroicons-arrows-up-down" class="w-5 h-5" />
                    </span>
                    <span class="item-label">联动滚动 | Sync Scroll</span>
                  </div>
                  <label class="switch">
                    <input
                      type="checkbox"
                      :checked="configSyncScroll"
                      @change="$emit('toggleSyncScroll')"
                    >
                    <span class="slider"></span>
                  </label>
                </div>

                <!-- 段落长度 -->
                <div class="menu-item">
                  <div class="item-info">
                    <span class="item-icon">
                      <UIcon name="i-heroicons-bars-3-bottom-left" class="w-5 h-5" />
                    </span>
                    <span class="item-label">段落长度 | Paragraph Length</span>
                  </div>
                </div>
                <div class="menu-item paragraph-length-item">
                  <div class="paragraph-length-options">
                    <button
                      v-for="length in paragraphLengthOptions"
                      :key="length"
                      class="length-option"
                      :class="{ 'active': configParagraphLength === length }"
                      @click="$emit('update:configParagraphLength', length)"
                    >
                      {{ length }}
                    </button>
                  </div>
                </div>

                <!-- 中文字号 -->
                <div class="menu-item">
                  <div class="item-info">
                    <span class="item-icon">
                      <UIcon name="i-heroicons-language" class="w-5 h-5" />
                    </span>
                    <span class="item-label">中文字号 | Chinese Font</span>
                  </div>
                  <div class="font-size-controls">
                    <button
                      class="font-size-btn"
                      :disabled="configChineseFontSize <= 0.8"
                      @click="$emit('update:configChineseFontSize', Math.max(0.8, configChineseFontSize - 0.1))"
                    >
                      <UIcon name="i-heroicons-minus" class="w-4 h-4" />
                    </button>
                    <span class="font-size-value">{{ configChineseFontSize.toFixed(1) }}</span>
                    <button
                      class="font-size-btn"
                      :disabled="configChineseFontSize >= 2.0"
                      @click="$emit('update:configChineseFontSize', Math.min(2.0, configChineseFontSize + 0.1))"
                    >
                      <UIcon name="i-heroicons-plus" class="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <!-- 英文字号 -->
                <div class="menu-item">
                  <div class="item-info">
                    <span class="item-icon">
                      <UIcon name="i-heroicons-language" class="w-5 h-5" />
                    </span>
                    <span class="item-label">英文字号 | English Font</span>
                  </div>
                  <div class="font-size-controls">
                    <button
                      class="font-size-btn"
                      :disabled="configEnglishFontSize <= 0.8"
                      @click="$emit('update:configEnglishFontSize', Math.max(0.8, configEnglishFontSize - 0.1))"
                    >
                      <UIcon name="i-heroicons-minus" class="w-4 h-4" />
                    </button>
                    <span class="font-size-value">{{ configEnglishFontSize.toFixed(1) }}</span>
                    <button
                      class="font-size-btn"
                      :disabled="configEnglishFontSize >= 2.0"
                      @click="$emit('update:configEnglishFontSize', Math.min(2.0, configEnglishFontSize + 0.1))"
                    >
                      <UIcon name="i-heroicons-plus" class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  backdrop-filter: blur(4px);
}

.menu-panel {
  width: 400px;
  max-width: 90vw;
  height: 100dvh;
  background: linear-gradient(135deg, var(--bg-color) 0%, var(--bg-secondary) 100%);
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.15);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(135deg, var(--bg-color) 0%, rgba(var(--primary-rgb), 0.05) 100%);
  flex-shrink: 0;
}

.menu-header h3 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--text-color);
  font-weight: 600;
}

.menu-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color);
}

.menu-close-btn:hover {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  transform: rotate(90deg);
}

.menu-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.menu-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.menu-section h4 {
  margin: 0 0 8px 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--primary-color);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background-color: var(--bg-color);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  transition: all 0.2s ease;
  cursor: pointer;
}

.menu-item:hover {
  border-color: var(--primary-color);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.1);
}

.item-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.item-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
}

.item-label {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-color);
}

.theme-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
}

/* 开关样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 26px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #cbd5e1;
  transition: all 0.3s ease;
  border-radius: 26px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 4px;
  bottom: 4px;
  background-color: white;
  transition: all 0.3s ease;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

input:checked + .slider {
  background-color: var(--primary-color);
}

input:checked + .slider:before {
  transform: translateX(24px);
}

/* 段落长度选项 */
.paragraph-length-item {
  padding-top: 0;
  margin-top: -8px;
  cursor: default;
}

.paragraph-length-item:hover {
  transform: none;
  box-shadow: none;
}

.paragraph-length-options {
  display: flex;
  gap: 4px;
  width: 100%;
}

.length-option {
  flex: 1;
  background: transparent;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 0.75rem;
  color: var(--text-color);
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 500;
  text-align: center;
}

.length-option:hover {
  border-color: var(--primary-color);
}

.length-option.active {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%);
  border-color: var(--primary-color);
  color: white;
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
}

/* 字号控制 */
.font-size-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.font-size-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--bg-secondary);
  color: var(--primary-color);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.font-size-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%);
  color: white;
  transform: scale(1.1);
}

.font-size-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.font-size-value {
  min-width: 30px;
  text-align: center;
  font-weight: 600;
  color: var(--primary-color);
  font-size: 0.85rem;
}

/* 动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

/* 深色主题 */
:global(.dark) .menu-panel {
  background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
}

:global(.dark) .menu-item {
  background-color: #2d2d2d;
  border-color: #404040;
}

:global(.dark) .menu-item:hover {
  border-color: var(--primary-color);
}

:global(.dark) .menu-header {
  background: linear-gradient(135deg, #1a1a1a 0%, rgba(0, 173, 181, 0.05) 100%);
  border-bottom-color: #404040;
}

:global(.dark) .menu-overlay {
  background-color: rgba(0, 0, 0, 0.7);
}

/* 响应式 */
@media (max-width: 768px) {
  .menu-panel {
    width: 85vw;
  }
}
</style>
