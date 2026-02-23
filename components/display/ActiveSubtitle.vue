<script setup lang="ts">
import type { ActiveSubtitle } from '~/types/subtitle'
import type { LanguageMode } from '~/composables/useSubtitles'

interface Props {
  subtitle: ActiveSubtitle
  languageMode: LanguageMode
}

const props = defineProps<Props>()

const displayText = computed(() => {
  switch (props.languageMode) {
    case 'chinese':
      return props.subtitle.rawText
    case 'english':
      return props.subtitle.translatedText
    default:
      return null // 双语模式由模板处理
  }
})
</script>

<template>
  <div class="active-subtitle bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-2">
    <!-- 单语模式 -->
    <template v-if="displayText">
      <p class="text-lg">
        <span class="animate-pulse">|</span>
        {{ displayText }}
      </p>
    </template>

    <!-- 双语模式 -->
    <template v-else>
      <p class="text-lg mb-1">
        <span class="animate-pulse text-blue-500">|</span>
        {{ subtitle.rawText }}
      </p>
      <p class="text-base text-gray-600 dark:text-gray-400 italic">
        {{ subtitle.translatedText }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.active-subtitle {
  border-left: 3px solid rgb(59 130 246); /* blue-500 */
}
</style>
