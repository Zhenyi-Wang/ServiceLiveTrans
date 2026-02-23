<script setup lang="ts">
// 字幕状态
const {
  activeSubtitle,
  confirmedSubtitles,
  languageMode,
  connectionStatus,
  handleMessage,
  setLanguageMode,
  _setConnectionStatus
} = useSubtitles()

// WebSocket 连接
const { status } = useWebSocket({
  onMessage: handleMessage,
  onOpen: () => _setConnectionStatus('connected'),
  onClose: () => _setConnectionStatus('disconnected'),
  onError: () => _setConnectionStatus('error')
})

// 同步连接状态
watch(status, (newStatus) => {
  _setConnectionStatus(newStatus)
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
    <!-- 头部 -->
    <header class="bg-white dark:bg-gray-800 shadow-sm px-4 py-3">
      <div class="max-w-4xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon name="i-heroicons-document-text" class="w-6 h-6 text-primary" />
          <h1 class="text-lg font-semibold">实时字幕</h1>
        </div>

        <div class="flex items-center gap-4">
          <!-- 语言切换 -->
          <SettingsLanguageToggle
            :model-value="languageMode"
            @update:model-value="setLanguageMode"
          />

          <!-- 连接状态 -->
          <CommonConnectionStatus :status="connectionStatus" />
        </div>
      </div>
    </header>

    <!-- 字幕显示区域 -->
    <main class="flex-1 max-w-4xl mx-auto w-full">
      <DisplaySubtitleDisplay
        :active-subtitle="activeSubtitle"
        :confirmed-subtitles="confirmedSubtitles"
        :language-mode="languageMode"
      />
    </main>

    <!-- 底部 -->
    <footer class="bg-white dark:bg-gray-800 border-t px-4 py-2">
      <div class="max-w-4xl mx-auto flex items-center justify-between text-sm text-gray-500">
        <span>ServiceLiveTrans Demo</span>
        <span>{{ confirmedSubtitles.length }} 条字幕</span>
      </div>
    </footer>
  </div>
</template>
