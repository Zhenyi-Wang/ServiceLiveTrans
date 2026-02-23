<script setup lang="ts">
definePageMeta({
  layout: false
})

// 状态
const isRunning = ref(false)
const isLoading = ref(false)
const status = ref<{
  isRunning: boolean
  connectionCount: number
  subtitleCount: number
  config: {
    optimizationDelay: number
    delayRandomRange: number
  }
} | null>(null)

// 获取状态
const fetchStatus = async () => {
  try {
    const response = await $fetch('/api/status')
    status.value = response as typeof status.value
    isRunning.value = (response as any).isRunning
  } catch (error) {
    console.error('Failed to fetch status:', error)
  }
}

// 开始模拟
const handleStart = async (delay?: number) => {
  isLoading.value = true
  try {
    await $fetch('/api/simulate/start', {
      method: 'POST',
      body: delay ? { delay } : undefined
    })
    isRunning.value = true
    await fetchStatus()
  } catch (error) {
    console.error('Failed to start simulation:', error)
  } finally {
    isLoading.value = false
  }
}

// 停止模拟
const handleStop = async () => {
  isLoading.value = true
  try {
    await $fetch('/api/simulate/stop', { method: 'POST' })
    isRunning.value = false
    await fetchStatus()
  } catch (error) {
    console.error('Failed to stop simulation:', error)
  } finally {
    isLoading.value = false
  }
}

// 清空字幕
const handleClear = async () => {
  isLoading.value = true
  try {
    await $fetch('/api/clear', { method: 'POST' })
    await fetchStatus()
  } catch (error) {
    console.error('Failed to clear subtitles:', error)
  } finally {
    isLoading.value = false
  }
}

// 当前延迟值
const currentDelay = computed(() => status.value?.config?.optimizationDelay ?? 2000)

// 定时获取状态
let statusInterval: NodeJS.Timeout | null = null

onMounted(() => {
  fetchStatus()
  statusInterval = setInterval(fetchStatus, 2000)
})

onUnmounted(() => {
  if (statusInterval) {
    clearInterval(statusInterval)
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <!-- 头部 -->
    <header class="bg-white dark:bg-gray-800 shadow-sm px-4 py-3">
      <div class="max-w-6xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon name="i-heroicons-cog-6-tooth" class="w-6 h-6 text-primary" />
          <h1 class="text-lg font-semibold">控制中心</h1>
        </div>

        <div class="flex items-center gap-4">
          <NuxtLink to="/" class="text-sm text-gray-500 hover:text-primary">
            <UButton variant="ghost" icon="i-heroicons-arrow-left">
              返回前台
            </UButton>
          </NuxtLink>
        </div>
      </div>
    </header>

    <!-- 主内容 -->
    <main class="max-w-6xl mx-auto p-4 space-y-4">
      <!-- 控制面板 -->
      <AdminControlPanel
        :is-running="isRunning"
        :is-loading="isLoading"
        :current-delay="currentDelay"
        @start="handleStart"
        @stop="handleStop"
        @clear="handleClear"
      />

      <!-- 状态面板 -->
      <AdminStatusPanel :status="status" />

      <!-- 快捷链接 -->
      <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
        <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <UIcon name="i-heroicons-link" class="w-5 h-5" />
          快捷链接
        </h3>

        <div class="flex gap-4">
          <NuxtLink to="/" target="_blank">
            <UButton variant="outline" icon="i-heroicons-arrow-top-right-on-square">
              打开前台页面
            </UButton>
          </NuxtLink>
        </div>
      </div>
    </main>
  </div>
</template>
