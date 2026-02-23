<script setup lang="ts">
import type { LanguageMode } from '~/composables/useSubtitles'

interface Props {
  modelValue: LanguageMode
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: LanguageMode]
}>()

const options: { value: LanguageMode; label: string; icon: string }[] = [
  { value: 'chinese', label: '中文', icon: 'i-heroicons-language' },
  { value: 'english', label: 'English', icon: 'i-heroicons-language' },
  { value: 'bilingual', label: '双语', icon: 'i-heroicons-document-text' }
]

const selectedOption = computed(() => {
  return options.find(opt => opt.value === props.modelValue) || options[2]
})

const handleChange = (value: LanguageMode) => {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="language-toggle">
    <UPopover>
      <UButton
        :icon="selectedOption.icon"
        color="gray"
        variant="ghost"
      >
        {{ selectedOption.label }}
        <template #trailing>
          <UIcon name="i-heroicons-chevron-down" class="w-4 h-4" />
        </template>
      </UButton>

      <template #panel>
        <div class="p-2">
          <UButton
            v-for="option in options"
            :key="option.value"
            :icon="option.icon"
            :color="modelValue === option.value ? 'primary' : 'gray'"
            :variant="modelValue === option.value ? 'soft' : 'ghost'"
            block
            class="justify-start mb-1"
            @click="handleChange(option.value)"
          >
            {{ option.label }}
          </UButton>
        </div>
      </template>
    </UPopover>
  </div>
</template>
