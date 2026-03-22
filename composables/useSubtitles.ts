import type { CurrentSubtitle, ConfirmedSubtitle } from '~/types/subtitle'
import type { WSMessage } from '~/types/websocket'
import type { ConnectionStatus } from './useWebSocket'

export type LanguageMode = 'chinese' | 'english' | 'bilingual'

export function useSubtitles() {
  // 字幕状态
  const currentSubtitle = ref<CurrentSubtitle | null>(null)  // 当前输入
  const confirmedSubtitles = ref<ConfirmedSubtitle[]>([])     // 已确认字幕列表
  const currentVersion = ref(0)       // 中文版本号
  const currentEnVersion = ref(0)     // 英文版本号（单独判断）

  // 语言模式（持久化到 localStorage）
  const languageMode = useLocalStorage<LanguageMode>('languageMode', 'bilingual')

  // 连接状态
  const connectionStatus = ref<ConnectionStatus>('disconnected')

  // 处理 WebSocket 消息
  const handleMessage = (message: WSMessage) => {
    switch (message.type) {
      case 'init':
        if (message.data && 'current' in message.data) {
          const data = message.data as any
          currentSubtitle.value = data.current ? {
            text: data.current,
            enText: '',
            version: 0,
            enVersion: 0,
            startTime: Date.now()
          } : null
          confirmedSubtitles.value = data.confirmed || []
        }
        break

      case 'current':
        if (message.data && 'text' in message.data) {
          const data = message.data as any

          // 中文版本更新
          if (data.version > currentVersion.value) {
            currentVersion.value = data.version
            currentSubtitle.value = {
              text: data.text,
              enText: data.enText || currentSubtitle.value?.enText || '',
              version: data.version,
              enVersion: data.enVersion || currentEnVersion.value,
              startTime: Date.now()
            }
          }

          // 英文版本更新（enText 非空且 enVersion 更新）
          if (data.enText && data.enVersion > currentEnVersion.value) {
            currentEnVersion.value = data.enVersion
            if (currentSubtitle.value) {
              currentSubtitle.value.enText = data.enText
              currentSubtitle.value.enVersion = data.enVersion
            }
          }
        }
        break

      case 'confirmed':
        if (message.data && 'id' in message.data) {
          const data = message.data as any
          const existingIndex = confirmedSubtitles.value.findIndex(s => s.id === data.id)

          if (existingIndex !== -1) {
            // 已存在：更新数据
            confirmedSubtitles.value[existingIndex] = {
              ...confirmedSubtitles.value[existingIndex],
              optimizedText: data.optimizedText,
              enText: data.enText
            }
          } else {
            // 不存在：添加新字幕
            const newSubtitle: ConfirmedSubtitle = {
              id: data.id,
              text: data.text,
              optimizedText: data.optimizedText,
              enText: data.enText,
              timestamp: Date.now()
            }
            confirmedSubtitles.value.push(newSubtitle)
            // 清空当前输入
            currentSubtitle.value = null
            currentVersion.value = 0
            currentEnVersion.value = 0
          }
        }
        break

      case 'clear':
        currentSubtitle.value = null
        confirmedSubtitles.value = []
        currentVersion.value = 0
        currentEnVersion.value = 0
        break
    }
  }

  // 设置语言模式
  const setLanguageMode = (mode: LanguageMode) => {
    languageMode.value = mode
  }

  // 清空字幕
  const clearSubtitles = () => {
    currentSubtitle.value = null
    confirmedSubtitles.value = []
  }

  return {
    // 状态
    currentSubtitle: readonly(currentSubtitle),
    confirmedSubtitles: readonly(confirmedSubtitles),
    currentVersion: readonly(currentVersion),
    currentEnVersion: readonly(currentEnVersion),
    languageMode: readonly(languageMode),
    connectionStatus: readonly(connectionStatus),

    // 方法
    handleMessage,
    setLanguageMode,
    clearSubtitles,

    // 内部状态设置（供 useWebSocket 使用）
    _setConnectionStatus: (status: ConnectionStatus) => {
      connectionStatus.value = status
    }
  }
}
