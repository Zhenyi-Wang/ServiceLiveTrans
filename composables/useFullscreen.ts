import { useStorage } from '@vueuse/core'

/**
 * 全屏控制 composable
 * 管理中文区和英文区的独立全屏状态
 */
export function useFullscreen() {
  // 中文区全屏状态
  const isChineseFullscreen = useStorage('is-chinese-fullscreen', false)

  // 英文区全屏状态
  const isEnglishFullscreen = useStorage('is-english-fullscreen', false)

  // 切换中文区全屏
  const toggleChineseFullscreen = () => {
    isChineseFullscreen.value = !isChineseFullscreen.value
    // 如果中文区进入全屏，则关闭英文区全屏
    if (isChineseFullscreen.value) {
      isEnglishFullscreen.value = false
    }
  }

  // 切换英文区全屏
  const toggleEnglishFullscreen = () => {
    isEnglishFullscreen.value = !isEnglishFullscreen.value
    // 如果英文区进入全屏，则关闭中文区全屏
    if (isEnglishFullscreen.value) {
      isChineseFullscreen.value = false
    }
  }

  // 退出所有全屏
  const exitAllFullscreen = () => {
    isChineseFullscreen.value = false
    isEnglishFullscreen.value = false
  }

  // 中文区样式类
  const getChineseSectionClasses = computed(() => ({
    'chinese-section': true,
    'hidden': isEnglishFullscreen.value,
    'fullscreen': isChineseFullscreen.value
  }))

  // 英文区样式类
  const getEnglishSectionClasses = computed(() => ({
    'english-section': true,
    'hidden': isChineseFullscreen.value,
    'fullscreen': isEnglishFullscreen.value
  }))

  // 中文区头部样式类
  const getChineseHeaderClasses = computed(() => ({
    'fullscreen': isChineseFullscreen.value,
    'disabled': isEnglishFullscreen.value
  }))

  // 英文区头部样式类
  const getEnglishHeaderClasses = computed(() => ({
    'fullscreen': isEnglishFullscreen.value,
    'disabled': isChineseFullscreen.value
  }))

  // 分隔线样式类
  const getDividerClasses = computed(() => ({
    'divider': true,
    'hidden': isChineseFullscreen.value || isEnglishFullscreen.value
  }))

  return {
    // 状态
    isChineseFullscreen: readonly(isChineseFullscreen),
    isEnglishFullscreen: readonly(isEnglishFullscreen),

    // 方法
    toggleChineseFullscreen,
    toggleEnglishFullscreen,
    exitAllFullscreen,

    // 样式类
    getChineseSectionClasses,
    getEnglishSectionClasses,
    getChineseHeaderClasses,
    getEnglishHeaderClasses,
    getDividerClasses
  }
}
