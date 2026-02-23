<script setup lang="ts">
interface Props {
  title: string
  isFullscreen: boolean
  fontSize: number
  language: 'chinese' | 'english'
  autoScroll: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  fullscreen: []
  'font-size-change': [value: number]
  'toggle-auto-scroll': []
  'scroll-to-bottom': []
}>()

const handleAutoScrollClick = () => {
  emit('toggle-auto-scroll')
  nextTick(() => {
    emit('scroll-to-bottom')
  })
}
</script>

<template>
  <div
    class="section-header"
    :class="{ fullscreen: isFullscreen }"
  >
    <div class="header-left">
      <button
        class="control-btn fullscreen-btn"
        :title="isFullscreen ? '退出全屏' : '全屏'"
        @click="$emit('fullscreen')"
      >
        <UIcon :name="isFullscreen ? 'i-heroicons-arrows-pointing-in' : 'i-heroicons-arrows-pointing-out'" class="w-4 h-4" />
      </button>
      <h3
        class="section-title clickable"
        @click="$emit('fullscreen')"
      >
        {{ title }}
      </h3>
    </div>

    <div class="header-right">
      <button
        class="control-btn auto-scroll-btn"
        :class="{ active: autoScroll }"
        title="自动滚动 | Auto Scroll"
        @click="handleAutoScrollClick"
      >
        <UIcon name="i-heroicons-arrow-down" class="w-4 h-4" />
      </button>

      <div class="font-size-controls">
        <button
          class="control-btn"
          :disabled="fontSize <= 0.8"
          title="减小字号"
          @click="$emit('font-size-change', Math.max(0.8, fontSize - 0.1))"
        >
          <UIcon name="i-heroicons-minus" class="w-4 h-4" />
        </button>
        <button
          class="control-btn"
          :disabled="fontSize >= 2.0"
          title="增大字号"
          @click="$emit('font-size-change', Math.min(2.0, fontSize + 0.1))"
        >
          <UIcon name="i-heroicons-plus" class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.section-header.fullscreen {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%);
  color: white;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-color);
  transition: all 0.2s ease;
}

.section-header.fullscreen .section-title {
  color: white;
}

.section-title.clickable {
  cursor: pointer;
  user-select: none;
}

.section-title.clickable:hover {
  transform: scale(1.02);
}

.font-size-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.control-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--bg-color);
  color: var(--primary-color);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.control-btn:hover:not(:disabled) {
  transform: scale(1.1);
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%);
  color: white;
}

.control-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.section-header.fullscreen .control-btn {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.section-header.fullscreen .control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.35);
  color: white;
}

/* 自动滚动按钮 */
.auto-scroll-btn {
  background: var(--bg-color);
  color: var(--text-muted);
  border: 2px solid var(--border-color);
}

.auto-scroll-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.auto-scroll-btn.active {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%);
  color: white;
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.4);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.4);
  }
  50% {
    box-shadow: 0 4px 16px rgba(var(--primary-rgb), 0.6);
  }
}

.section-header.fullscreen .auto-scroll-btn {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.8);
  border-color: rgba(255, 255, 255, 0.3);
}

.section-header.fullscreen .auto-scroll-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.6);
  color: white;
}

.section-header.fullscreen .auto-scroll-btn.active {
  background: rgba(255, 255, 255, 0.95);
  color: var(--primary-color);
  border-color: rgba(255, 255, 255, 0.95);
}

/* 深色主题 */
:global(.dark) .section-header {
  background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
  border-bottom-color: #4a5568;
}

:global(.dark) .control-btn {
  background: #4a5568;
  color: var(--primary-color);
}

:global(.dark) .control-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%);
  color: white;
}

:global(.dark) .auto-scroll-btn {
  background: #4a5568;
  color: #a0aec0;
  border-color: #4a5568;
}

/* 响应式 */
@media (max-width: 768px) {
  .section-header {
    padding: 8px 15px;
  }

  .section-title {
    font-size: 0.9rem;
  }

  .control-btn {
    width: 28px;
    height: 28px;
  }
}
</style>
