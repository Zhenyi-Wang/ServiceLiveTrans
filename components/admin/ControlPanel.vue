<script setup lang="ts">
interface Props {
  isRunning: boolean
  isLoading?: boolean
  currentDelay?: number
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false,
  currentDelay: 2000
})

const emit = defineEmits<{
  start: [delay?: number]
  stop: []
  clear: []
}>()

// 延迟配置
const delayValue = ref(props.currentDelay)

// 监听 props 变化
watch(() => props.currentDelay, (newVal) => {
  delayValue.value = newVal
})

const handleStart = () => {
  emit('start', delayValue.value)
}

const handleStop = () => {
  emit('stop')
}

const handleClear = () => {
  emit('clear')
}

// 延迟预设选项
const delayPresets = [
  { label: '1秒', value: 1000 },
  { label: '2秒', value: 2000 },
  { label: '3秒', value: 3000 },
  { label: '5秒', value: 5000 }
]
</script>

<template>
  <div class="control-panel bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
    <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <UIcon name="i-heroicons-play-circle" class="w-5 h-5" />
      模拟控制
    </h3>

    <!-- 延迟配置 -->
    <div class="mb-4">
      <label class="block text-sm text-gray-500 mb-2">
        优化翻译延迟: {{ delayValue }}ms (±1秒随机)
      </label>
      <div class="flex items-center gap-4">
        <USlider
          v-model="delayValue"
          :min="500"
          :max="10000"
          :step="500"
          :disabled="isRunning"
          class="flex-1"
        />
        <div class="flex gap-2">
          <UButton
            v-for="preset in delayPresets"
            :key="preset.value"
            size="xs"
            :color="delayValue === preset.value ? 'primary' : 'gray'"
            :variant="delayValue === preset.value ? 'solid' : 'outline'"
            :disabled="isRunning"
            @click="delayValue = preset.value"
          >
            {{ preset.label }}
          </UButton>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-3">
      <!-- 开始按钮 -->
      <UButton
        v-if="!isRunning"
        color="primary"
        size="lg"
        icon="i-heroicons-play"
        :loading="isLoading"
        @click="handleStart"
      >
        开始模拟
      </UButton>

      <!-- 停止按钮 -->
      <UButton
        v-else
        color="red"
        size="lg"
        icon="i-heroicons-stop"
        :loading="isLoading"
        @click="handleStop"
      >
        停止模拟
      </UButton>

      <!-- 清空按钮 -->
      <UButton
        color="gray"
        size="lg"
        icon="i-heroicons-trash"
        variant="outline"
        :disabled="isRunning || isLoading"
        @click="handleClear"
      >
        清空字幕
      </UButton>
    </div>

    <!-- 状态指示 -->
    <div class="mt-4 flex items-center gap-2">
      <span class="text-sm text-gray-500">状态:</span>
      <UBadge :color="isRunning ? 'green' : 'gray'">
        {{ isRunning ? '运行中' : '已停止' }}
      </UBadge>
    </div>
  </div>
</template>
