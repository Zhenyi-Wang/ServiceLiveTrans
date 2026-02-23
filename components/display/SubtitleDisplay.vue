<script setup lang="ts">
import type { ActiveSubtitle, ConfirmedSubtitle } from '~/types/subtitle'
import type { LanguageMode } from '~/composables/useSubtitles'

interface Props {
  activeSubtitle: ActiveSubtitle | null
  confirmedSubtitles: ConfirmedSubtitle[]
  languageMode: LanguageMode
}

const props = defineProps<Props>()

// 滚动容器引用
const scrollContainer = ref<HTMLElement | null>(null)

// 监听字幕变化，自动滚动
watch(
  () => props.confirmedSubtitles.length,
  () => {
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
      }
    })
  }
)

// 监听活动字幕变化
watch(
  () => props.activeSubtitle?.rawText,
  () => {
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
      }
    })
  }
)
</script>

<template>
  <div
    ref="scrollContainer"
    class="subtitle-display h-full overflow-y-auto p-4 space-y-2"
  >
    <!-- 空状态 -->
    <div
      v-if="confirmedSubtitles.length === 0 && !activeSubtitle"
      class="flex items-center justify-center h-full text-gray-400"
    >
      <div class="text-center">
        <UIcon name="i-heroicons-document-text" class="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>等待字幕...</p>
      </div>
    </div>

    <!-- 已确认的字幕列表 -->
    <TransitionGroup name="subtitle">
      <DisplayConfirmedSubtitle
        v-for="subtitle in confirmedSubtitles"
        :key="subtitle.id"
        :subtitle="subtitle"
        :language-mode="languageMode"
      />
    </TransitionGroup>

    <!-- 正在转录的字幕 -->
    <Transition name="fade">
      <DisplayActiveSubtitle
        v-if="activeSubtitle"
        :subtitle="activeSubtitle"
        :language-mode="languageMode"
      />
    </Transition>
  </div>
</template>

<style scoped>
.subtitle-display {
  scroll-behavior: smooth;
}

.subtitle-enter-active,
.subtitle-leave-active {
  transition: all 0.3s ease;
}

.subtitle-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.subtitle-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
