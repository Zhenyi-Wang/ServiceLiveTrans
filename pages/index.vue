<script setup lang="ts">
// 配置管理
const {
  isDark,
  toggleDark,
  showMenu,
  toggleMenu,
  closeMenu,
  configAutoScroll,
  toggleAutoScroll,
  configSyncScroll,
  toggleSyncScroll,
  configParagraphLength,
  configChineseFontSize,
  configEnglishFontSize,
  cssVariables
} = useSettings()

// 字幕状态
const {
  activeSubtitle,
  confirmedSubtitles,
  connectionStatus,
  handleMessage,
  _setConnectionStatus
} = useSubtitles()

// WebSocket 连接
const { status } = useWebSocket({
  onMessage: handleMessage
})

// 同步 WebSocket 状态到 useSubtitles
watch(status, (newStatus) => {
  _setConnectionStatus(newStatus)
}, { immediate: true })

// 全屏控制
const {
  isChineseFullscreen,
  isEnglishFullscreen,
  getChineseSectionClasses,
  getEnglishSectionClasses,
  getDividerClasses,
  toggleChineseFullscreen,
  toggleEnglishFullscreen
} = useFullscreen()

// 联动滚动
const { scrollToBottom } = useScrollSync(configSyncScroll, configAutoScroll)

// 是否等待服务
const isWaitingForService = computed(() =>
  connectionStatus.value !== 'connected' || confirmedSubtitles.value.length === 0
)

// 处理字号变化
const handleChineseFontSizeChange = (value: number) => {
  configChineseFontSize.value = Math.round(value * 10) / 10
}

const handleEnglishFontSizeChange = (value: number) => {
  configEnglishFontSize.value = Math.round(value * 10) / 10
}

// 处理自动滚动切换
const handleToggleAutoScroll = () => {
  toggleAutoScroll()
}
</script>

<template>
  <ClientOnly>
    <div
      class="optimized-layout"
      :style="cssVariables"
    >
      <!-- 顶部导航 -->
      <LayoutAppHeader
        :ws-connected="connectionStatus === 'connected'"
        :show-menu="showMenu"
        :is-dark="isDark"
        :connection-status="connectionStatus"
        @toggle-menu="toggleMenu"
        @toggle-dark="toggleDark"
      />

      <!-- 设置抽屉 -->
      <LayoutSettingsDrawer
        :show="showMenu"
        :is-dark="isDark"
        :config-auto-scroll="configAutoScroll"
        :config-sync-scroll="configSyncScroll"
        :config-paragraph-length="configParagraphLength"
        :config-chinese-font-size="configChineseFontSize"
        :config-english-font-size="configEnglishFontSize"
        @close="closeMenu"
        @toggle-dark="toggleDark"
        @toggle-auto-scroll="toggleAutoScroll"
        @toggle-sync-scroll="toggleSyncScroll"
        @scroll-to-bottom="scrollToBottom"
        @update:config-paragraph-length="configParagraphLength = $event"
        @update:config-chinese-font-size="configChineseFontSize = $event"
        @update:config-english-font-size="configEnglishFontSize = $event"
      />

      <!-- 内容容器 -->
      <div class="content-container">
        <!-- 中文内容区域 -->
        <ContentSection
          v-show="!isEnglishFullscreen"
          language="chinese"
          title="中文 | Chinese"
          :subtitles="confirmedSubtitles"
          :active-subtitle="activeSubtitle"
          :font-size="configChineseFontSize"
          :is-fullscreen="isChineseFullscreen"
          :is-waiting-for-service="isWaitingForService"
          :auto-scroll="configAutoScroll"
          @fullscreen="toggleChineseFullscreen"
          @font-size-change="handleChineseFontSizeChange"
          @toggle-auto-scroll="handleToggleAutoScroll"
          @scroll-to-bottom="scrollToBottom"
        />

        <!-- 分隔线 -->
        <ContentSectionDivider
          v-show="!isChineseFullscreen && !isEnglishFullscreen"
        />

        <!-- 英文内容区域 -->
        <ContentSection
          v-show="!isChineseFullscreen"
          language="english"
          title="English"
          :subtitles="confirmedSubtitles"
          :active-subtitle="activeSubtitle"
          :font-size="configEnglishFontSize"
          :is-fullscreen="isEnglishFullscreen"
          :is-waiting-for-service="isWaitingForService"
          :auto-scroll="configAutoScroll"
          @fullscreen="toggleEnglishFullscreen"
          @font-size-change="handleEnglishFontSizeChange"
          @toggle-auto-scroll="handleToggleAutoScroll"
          @scroll-to-bottom="scrollToBottom"
        />
      </div>
    </div>
  </ClientOnly>
</template>

<style scoped>
/* 布局由全局 CSS 处理 */
</style>
