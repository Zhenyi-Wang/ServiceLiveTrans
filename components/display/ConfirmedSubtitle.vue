<script setup lang="ts">
import type { ConfirmedSubtitle } from '~/types/subtitle'
import type { LanguageMode } from '~/composables/useSubtitles'

interface Props {
  subtitle: ConfirmedSubtitle
  languageMode: LanguageMode
}

const props = defineProps<Props>()

const displayText = computed(() => {
  switch (props.languageMode) {
    case 'chinese':
      return props.subtitle.optimizedText
    case 'english':
      return props.subtitle.translatedText
    default:
      return null // 双语模式由模板处理
  }
})

// 格式化时间戳
const formattedTime = computed(() => {
  const date = new Date(props.subtitle.timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
})
</script>

<template>
  <div class="confirmed-subtitle bg-white dark:bg-gray-800 rounded-lg p-3 mb-2 shadow-sm">
    <!-- 单语模式 -->
    <template v-if="displayText">
      <p class="text-base">{{ displayText }}</p>
    </template>

    <!-- 双语模式 -->
    <template v-else>
      <p class="text-base mb-1">{{ subtitle.optimizedText }}</p>
      <p class="text-sm text-gray-600 dark:text-gray-400 italic">
        {{ subtitle.translatedText }}
      </p>
    </template>

    <!-- 时间戳 -->
    <p class="text-xs text-gray-400 mt-1">{{ formattedTime }}</p>
  </div>
</template>
