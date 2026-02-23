<script setup lang="ts">
import type { ActiveSubtitle, ConfirmedSubtitle } from '~/types/subtitle'

interface Props {
  language: 'chinese' | 'english'
  title: string
  subtitles: ConfirmedSubtitle[]
  activeSubtitle: ActiveSubtitle | null
  fontSize: number
  isFullscreen: boolean
  isWaitingForService: boolean
  autoScroll: boolean
}

const props = defineProps<Props>()

defineEmits<{
  fullscreen: []
  'font-size-change': [value: number]
  scroll: [event: Event]
  'toggle-auto-scroll': []
  'scroll-to-bottom': []
}>()

const welcomeMessage = computed(() => {
  return props.language === 'chinese'
    ? '等待字幕数据...'
    : 'Waiting for subtitles...'
})

const sectionClasses = computed(() => ({
  'content-section': true,
  'fullscreen': props.isFullscreen,
  [`${props.language}-section`]: true
}))
</script>

<template>
  <div
    class="content-section"
    :class="sectionClasses"
  >
    <ContentSectionHeader
      :title="title"
      :is-fullscreen="isFullscreen"
      :font-size="fontSize"
      :language="language"
      :auto-scroll="autoScroll"
      @fullscreen="$emit('fullscreen')"
      @font-size-change="$emit('font-size-change', $event)"
      @toggle-auto-scroll="$emit('toggle-auto-scroll')"
      @scroll-to-bottom="$emit('scroll-to-bottom')"
    />

    <div
      class="content-area"
      :class="`${language}-content`"
    >
      <!-- 欢迎信息 -->
      <div
        v-if="isWaitingForService && subtitles.length === 0"
        class="welcome-message"
      >
        {{ welcomeMessage }}
      </div>

      <!-- 段落显示 -->
      <ContentParagraphDisplay
        v-if="subtitles.length > 0"
        :language="language"
        :subtitles="subtitles"
        :font-size="fontSize"
        @scroll="$emit('scroll', $event)"
      />

      <!-- 当前输入 -->
      <ContentCurrentInput
        v-if="!isWaitingForService"
        :language="language"
        :active-subtitle="activeSubtitle"
        :font-size="fontSize"
      />
    </div>
  </div>
</template>

<style scoped>
.content-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.3s ease;
}

.content-section.fullscreen {
  flex: 1;
  height: 100%;
}

.content-section.hidden {
  display: none;
}

.content-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.welcome-message {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2em 20px;
  color: var(--text-secondary);
  font-style: italic;
  line-height: 1.6;
}

.english-content .welcome-message {
  color: var(--text-muted);
}

/* 深色主题 */
:global(.dark) .welcome-message {
  color: #999;
}
</style>
