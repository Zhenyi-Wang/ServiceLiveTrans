import { useThrottleFn } from '@vueuse/core'
import type { Ref } from 'vue'

/**
 * 联动滚动 composable
 * 管理中英文区域的滚动同步
 */
export function useScrollSync(
  configSyncScroll: Ref<boolean>,
  configAutoScroll: Ref<boolean>
) {
  // 滚动容器引用
  const chineseScrollContainer = ref<HTMLElement | null>(null)
  const englishScrollContainer = ref<HTMLElement | null>(null)

  // 是否正在同步滚动（防止循环触发）
  let isSyncing = false

  /**
   * 平滑滚动到目标位置
   */
  const smoothScrollTo = (
    element: HTMLElement,
    targetScrollTop: number,
    duration: number = 300
  ) => {
    const startScrollTop = element.scrollTop
    const distance = targetScrollTop - startScrollTop
    const startTime = performance.now()

    const easeInOutQuad = (t: number) =>
      t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easeProgress = easeInOutQuad(progress)

      element.scrollTop = startScrollTop + distance * easeProgress

      if (progress < 1) {
        requestAnimationFrame(animateScroll)
      }
    }

    requestAnimationFrame(animateScroll)
  }

  /**
   * 滚动到底部
   */
  const scrollToBottom = () => {
    if (chineseScrollContainer.value) {
      const chineseTarget = chineseScrollContainer.value.scrollHeight
      smoothScrollTo(chineseScrollContainer.value, chineseTarget, 500)
    }
    if (englishScrollContainer.value) {
      const englishTarget = englishScrollContainer.value.scrollHeight
      smoothScrollTo(englishScrollContainer.value, englishTarget, 500)
    }
  }

  /**
   * 联动滚动处理
   */
  const syncScroll = (
    sourceElement: HTMLElement,
    targetElement: HTMLElement | null
  ) => {
    if (!targetElement || isSyncing || !configSyncScroll.value) return

    isSyncing = true

    // 计算滚动比例
    const sourceMaxScroll = sourceElement.scrollHeight - sourceElement.clientHeight
    const targetMaxScroll = targetElement.scrollHeight - targetElement.clientHeight

    if (sourceMaxScroll > 0 && targetMaxScroll > 0) {
      const scrollRatio = sourceElement.scrollTop / sourceMaxScroll
      const targetScrollTop = scrollRatio * targetMaxScroll
      smoothScrollTo(targetElement, targetScrollTop, 100)
    }

    // 重置同步标志
    setTimeout(() => {
      isSyncing = false
    }, 150)
  }

  /**
   * 中文区域滚动处理
   */
  const onChineseScroll = useThrottleFn((event: Event) => {
    if (!configSyncScroll.value) return
    const target = event.target as HTMLElement
    syncScroll(target, englishScrollContainer.value)
  }, 50)

  /**
   * 英文区域滚动处理
   */
  const onEnglishScroll = useThrottleFn((event: Event) => {
    if (!configSyncScroll.value) return
    const target = event.target as HTMLElement
    syncScroll(target, chineseScrollContainer.value)
  }, 50)

  /**
   * 监听数据变化并自动滚动
   */
  const watchDataAndScroll = (
    activeSubtitle: Ref<any>,
    confirmedSubtitles: Ref<any[]>
  ) => {
    // 监听活动字幕变化
    watch(
      () => activeSubtitle.value,
      () => {
        if (configAutoScroll.value) {
          nextTick(() => scrollToBottom())
        }
      }
    )

    // 监听确认字幕变化
    watch(
      () => confirmedSubtitles.value?.length,
      () => {
        if (configAutoScroll.value) {
          nextTick(() => scrollToBottom())
        }
      }
    )
  }

  return {
    // 引用
    chineseScrollContainer,
    englishScrollContainer,

    // 方法
    scrollToBottom,
    onChineseScroll,
    onEnglishScroll,
    watchDataAndScroll
  }
}
