<script setup lang="ts">
import type { ConfirmedSubtitle } from '~/types/subtitle'

interface Props {
  language: 'chinese' | 'english'
  subtitles: ConfirmedSubtitle[]
  fontSize: number
}

const props = defineProps<Props>()

defineEmits<{
  scroll: [event: Event]
}>()

const contentClasses = computed(() => ({
  'english-content': props.language === 'english'
}))

// 获取显示文本
const getDisplayText = (subtitle: ConfirmedSubtitle) => {
  if (props.language === 'chinese') {
    return subtitle.optimizedText || subtitle.rawText
  }
  return subtitle.translatedText || ''
}
</script>

<template>
  <div
    class="article-display"
    @scroll="$emit('scroll', $event)"
  >
    <TransitionGroup name="segment">
      <div
        v-for="subtitle in subtitles"
        :key="subtitle.id"
        class="article-paragraph"
      >
        <div
          class="paragraph-content"
          :class="contentClasses"
          :style="{ fontSize: fontSize + 'rem' }"
        >
          <!-- 中文段落显示 -->
          <template v-if="language === 'chinese'">
            <span
              :class="[
                subtitle.optimizedText ? 'optimized-text' : 'unoptimized-text',
                'text-segment'
              ]"
            >
              {{ subtitle.optimizedText || subtitle.rawText }}
            </span>
          </template>

          <!-- 英文段落显示 -->
          <template v-else>
            <span
              v-if="subtitle.translatedText"
              class="text-segment english-segment has-translation"
            >
              <span class="translation-content">{{ subtitle.translatedText }}</span>
            </span>
            <span
              v-else
              class="text-segment english-segment pending"
            >
              <span class="translating-dots">...</span>
            </span>
          </template>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.article-display {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 20px 1em;
  -webkit-overflow-scrolling: touch;
  scroll-behavior: auto;
}

.article-paragraph {
  margin-bottom: 1.5em;
  position: relative;
  transition: all 0.3s ease;
}

.paragraph-content {
  color: var(--text-color);
  font-size: var(--chinese-font-size);
  line-height: 1.8;
  text-align: justify;
  text-indent: 2em;
  font-weight: 400;
  margin-bottom: 0.5em;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.english-content .paragraph-content {
  text-align: left;
  text-indent: 0;
}

.text-segment {
  display: inline;
}

.optimized-text {
  color: var(--text-color);
  font-weight: 400;
}

.unoptimized-text {
  color: var(--text-secondary);
  font-style: italic;
  opacity: 0.8;
}

.english-segment {
  line-height: 1.6;
  min-height: 1.6em;
}

.english-segment.pending {
  color: var(--text-muted);
  font-style: italic;
}

.english-segment.has-translation {
  color: var(--text-color);
}

.translating-dots {
  animation: dots 1.5s infinite;
}

.translation-content {
  display: inline;
  animation: fadeInUp 1.5s ease-out forwards;
}

@keyframes dots {
  0%, 20% { opacity: 0; }
  50% { opacity: 1; }
  80%, 100% { opacity: 0; }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.segment-enter-active {
  transition: all 0.5s ease-out;
}

.segment-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.segment-enter-to {
  opacity: 1;
  transform: translateY(0);
}

/* 深色主题 */
:global(.dark) .paragraph-content {
  color: #e2e8f0;
}

:global(.dark) .optimized-text {
  color: #e2e8f0;
}

:global(.dark) .unoptimized-text {
  color: #999;
}

/* 响应式 */
@media (max-width: 768px) {
  .article-display {
    padding: 0 15px 1em;
  }

  .paragraph-content {
    text-indent: 1.5em;
  }

  .article-paragraph {
    margin-bottom: 1.2em;
  }
}
</style>
