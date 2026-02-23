import { useStorage, useDark } from '@vueuse/core'

/**
 * 应用设置管理 composable
 * 管理主题、字号、滚动设置等用户偏好
 */
export function useSettings() {
  // 主题切换 - 使用 VueUse 的 useDark
  const isDark = useDark({
    selector: 'body',
    attribute: 'class',
    valueDark: 'dark',
    valueLight: '',
    initialValue: 'light'
  })

  const toggleDark = () => {
    isDark.value = !isDark.value
  }

  // 菜单显示状态
  const showMenu = ref(false)

  const toggleMenu = () => {
    showMenu.value = !showMenu.value
  }

  const closeMenu = () => {
    showMenu.value = false
  }

  // 自动滚动
  const configAutoScroll = useStorage('config-auto-scroll', true)

  const toggleAutoScroll = () => {
    configAutoScroll.value = !configAutoScroll.value
  }

  // 联动滚动
  const configSyncScroll = useStorage('config-sync-scroll', true)

  const toggleSyncScroll = () => {
    configSyncScroll.value = !configSyncScroll.value
  }

  // 段落长度
  const configParagraphLength = useStorage('config-paragraph-length', 150)

  const paragraphLengthOptions = [
    { value: 100, label: '短' },
    { value: 150, label: '中' },
    { value: 200, label: '长' }
  ]

  // 字号设置
  const configChineseFontSize = useStorage('config-chinese-font-size', 1.3)
  const configEnglishFontSize = useStorage('config-english-font-size', 1.2)

  const fontSizeStep = 0.1
  const minFontSize = 0.8
  const maxFontSize = 2.0

  const increaseChineseFontSize = () => {
    if (configChineseFontSize.value < maxFontSize) {
      configChineseFontSize.value = Math.round((configChineseFontSize.value + fontSizeStep) * 10) / 10
    }
  }

  const decreaseChineseFontSize = () => {
    if (configChineseFontSize.value > minFontSize) {
      configChineseFontSize.value = Math.round((configChineseFontSize.value - fontSizeStep) * 10) / 10
    }
  }

  const increaseEnglishFontSize = () => {
    if (configEnglishFontSize.value < maxFontSize) {
      configEnglishFontSize.value = Math.round((configEnglishFontSize.value + fontSizeStep) * 10) / 10
    }
  }

  const decreaseEnglishFontSize = () => {
    if (configEnglishFontSize.value > minFontSize) {
      configEnglishFontSize.value = Math.round((configEnglishFontSize.value - fontSizeStep) * 10) / 10
    }
  }

  // 是否可以调整字号
  const canIncreaseChinese = computed(() => configChineseFontSize.value < maxFontSize)
  const canDecreaseChinese = computed(() => configChineseFontSize.value > minFontSize)
  const canIncreaseEnglish = computed(() => configEnglishFontSize.value < maxFontSize)
  const canDecreaseEnglish = computed(() => configEnglishFontSize.value > minFontSize)

  // CSS 变量计算
  const cssVariables = computed(() => ({
    '--chinese-font-size': `${configChineseFontSize.value}rem`,
    '--english-font-size': `${configEnglishFontSize.value}rem`,
    '--chinese-input-height': `${configChineseFontSize.value * 1.8}em`,
    '--english-input-height': `${configEnglishFontSize.value * 1.6}em`
  }))

  return {
    // 主题
    isDark: readonly(isDark),
    toggleDark,

    // 菜单
    showMenu: readonly(showMenu),
    toggleMenu,
    closeMenu,

    // 自动滚动
    configAutoScroll: readonly(configAutoScroll),
    toggleAutoScroll,

    // 联动滚动
    configSyncScroll: readonly(configSyncScroll),
    toggleSyncScroll,

    // 段落长度
    configParagraphLength: readonly(configParagraphLength),
    paragraphLengthOptions,

    // 字号
    configChineseFontSize: readonly(configChineseFontSize),
    configEnglishFontSize: readonly(configEnglishFontSize),
    increaseChineseFontSize,
    decreaseChineseFontSize,
    increaseEnglishFontSize,
    decreaseEnglishFontSize,
    canIncreaseChinese,
    canDecreaseChinese,
    canIncreaseEnglish,
    canDecreaseEnglish,

    // CSS 变量
    cssVariables
  }
}
