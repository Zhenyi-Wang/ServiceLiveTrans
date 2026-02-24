<script setup lang="ts">
import type { ActiveSubtitle } from '~/types/subtitle'

interface Props {
  language: 'chinese' | 'english'
  activeSubtitle: ActiveSubtitle | null
  lastCurrentEn?: string
  fontSize: number
}

const props = defineProps<Props>()

const inputClasses = computed(() => ({
  'english-input': props.language === 'english'
}))

const contentClasses = computed(() => ({
  'english-content': props.language === 'english'
}))

const displayText = computed(() => {
  if (!props.activeSubtitle) return ''
  if (props.language === 'english') {
    return props.lastCurrentEn || props.activeSubtitle.translatedText || ''
  }
  return props.activeSubtitle.rawText || ''
})
</script>

<template>
  <div
    class="current-input"
    :class="inputClasses"
  >
    <div
      class="paragraph-content current-input-content"
      :class="contentClasses"
      :style="{ fontSize: fontSize + 'rem' }"
    >
      <span class="blinking-cursor">|</span>
      <span class="truncated-text">{{ displayText }}</span>
    </div>
  </div>
</template>

<style scoped>
.current-input {
  padding: 0.3em 20px 0.1em 20px;
  border-top: 1px solid var(--border-color);
  backdrop-filter: blur(5px);
  flex-shrink: 0;
  min-height: 2em;
  display: flex;
  align-items: center;
}

.current-input-content {
  color: var(--text-muted);
  font-style: italic;
  text-indent: 0;
  line-height: 1.8;
  transition: all 0.3s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  direction: rtl;
  text-align: left;
}

.blinking-cursor {
  color: var(--primary-color);
  font-weight: bold;
  animation: blink 1s infinite;
  margin-right: 6px;
}

.truncated-text {
  color: var(--text-muted);
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 深色主题 */
:global(.dark) .current-input {
  border-top-color: #4a5568;
  background: rgba(45, 55, 72, 0.5);
}

:global(.dark) .current-input-content {
  color: #999;
}

:global(.dark) .truncated-text {
  color: #999;
}

:global(.dark) .blinking-cursor {
  color: var(--primary-color);
}

/* 响应式 */
@media (max-width: 768px) {
  .current-input {
    padding: 0.2em 15px 0.1em 15px;
    min-height: 1.2em;
  }
}
</style>
