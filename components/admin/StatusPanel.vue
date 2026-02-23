<script setup lang="ts">
interface StatusData {
  isRunning: boolean
  connectionCount: number
  subtitleCount: number
  config: {
    optimizationDelay: number
    delayRandomRange: number
  }
}

interface Props {
  status: StatusData | null
}

const props = defineProps<Props>()

const isRunning = computed(() => props.status?.isRunning ?? false)
const connectionCount = computed(() => props.status?.connectionCount ?? 0)
const subtitleCount = computed(() => props.status?.subtitleCount ?? 0)
const optimizationDelay = computed(() => props.status?.config?.optimizationDelay ?? 2000)
const delayRandomRange = computed(() => props.status?.config?.delayRandomRange ?? 1000)
</script>

<template>
  <div class="status-panel bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
    <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <UIcon name="i-heroicons-chart-bar" class="w-5 h-5" />
      系统状态
    </h3>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <!-- 模拟状态 -->
      <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
        <p class="text-sm text-gray-500 mb-1">模拟状态</p>
        <p class="text-xl font-semibold">
          <UBadge :color="isRunning ? 'green' : 'gray'">
            {{ isRunning ? '运行中' : '已停止' }}
          </UBadge>
        </p>
      </div>

      <!-- 连接数 -->
      <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
        <p class="text-sm text-gray-500 mb-1">连接数</p>
        <p class="text-xl font-semibold">{{ connectionCount }}</p>
      </div>

      <!-- 字幕数 -->
      <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
        <p class="text-sm text-gray-500 mb-1">字幕数</p>
        <p class="text-xl font-semibold">{{ subtitleCount }}</p>
      </div>

      <!-- 优化延迟 -->
      <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
        <p class="text-sm text-gray-500 mb-1">优化延迟</p>
        <p class="text-xl font-semibold">{{ optimizationDelay }}ms</p>
        <p class="text-xs text-gray-400">±{{ delayRandomRange }}ms</p>
      </div>
    </div>
  </div>
</template>
