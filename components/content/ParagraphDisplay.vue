<script setup lang="ts">
interface ChineseSegment {
  text: string
  isOptimized: boolean
}

interface EnglishSegment {
  text: string
  isTranslating: boolean
  id: string
  hasContent: boolean
}

interface Props {
  language: 'chinese' | 'english'
  paragraphs: Array<Array<ChineseSegment | EnglishSegment> | null>
  fontSize: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  scroll: [event: Event]
  'container-ref': [el: HTMLElement | null]
}>()

const articleClasses = computed(() => ({
  'chinese-article': props.language === 'chinese',
  'english-article': props.language === 'english',
  'flex-article': true,
}))

const contentClasses = computed(() => ({
  'english-content': props.language === 'english',
}))

const setScrollContainerRef = (el: HTMLElement | null) => {
  emit('container-ref', el)
}
</script>

<template>
  <div
    :ref="setScrollContainerRef"
    class="article-display"
    :class="articleClasses"
    @scroll="$emit('scroll', $event)"
  >
    <div
      v-for="(paragraph, index) in paragraphs"
      :key="`${language}-${index}`"
      class="article-paragraph"
      :class="{ translating: language === 'english' && !paragraph }"
    >
      <div
        class="paragraph-content"
        :class="contentClasses"
        :style="{ fontSize: fontSize + 'rem' }"
      >
        <!-- 中文段落显示 -->
        <template v-if="language === 'chinese'">
          <TransitionGroup name="segment" tag="div" class="segments-container">
            <span
              v-for="(segment, segIndex) in paragraph as ChineseSegment[]"
              :key="`cn-${index}-${segIndex}`"
              :class="[segment.isOptimized ? 'optimized-text' : 'unoptimized-text', 'text-segment']"
            >
              {{ segment.text }}
            </span>
          </TransitionGroup>
        </template>

        <!-- 英文段落显示 -->
        <template v-else>
          <template v-if="paragraph">
            <span
              v-for="(segment, segIndex) in paragraph as EnglishSegment[]"
              :key="segment.id || `en-${index}-${segIndex}`"
              class="text-segment english-segment"
              :class="{
                translating: segment.isTranslating,
                'has-translation': segment.hasContent,
              }"
            >
              <span v-if="segment.hasContent" class="translation-content">{{ segment.text }} </span>
              <span v-if="segment.isTranslating" class="translating-dots">... </span>
              <span
                v-if="segment.hasContent && segIndex < (paragraph as EnglishSegment[]).length - 1"
              >
              </span>
            </span>
          </template>
        </template>
      </div>
    </div>
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
  0%,
  20% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  80%,
  100% {
    opacity: 0;
  }
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

.segments-container {
  display: inline;
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
