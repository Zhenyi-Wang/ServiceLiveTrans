import type { CurrentSubtitle, ConfirmedSubtitle } from '~/types/subtitle'
import type {
  WSInitData,
  WSCurrentData,
  WSConfirmedData,
  WSAIProcessedData,
  WSMessage,
} from '~/types/websocket'
import type { ConnectionStatus } from './useWebSocket'

export type LanguageMode = 'chinese' | 'english' | 'bilingual'

export function useSubtitles() {
  // 字幕状态
  const currentSubtitle = ref<CurrentSubtitle | null>(null) // 当前输入
  const confirmedSubtitles = ref<ConfirmedSubtitle[]>([]) // 已确认字幕列表
  const currentVersion = ref(0) // 中文版本号
  const currentEnVersion = ref(0) // 英文版本号（单独判断）

  // 语言模式（持久化到 localStorage）
  const languageMode = useLocalStorage<LanguageMode>('languageMode', 'bilingual')

  // 连接状态
  const connectionStatus = ref<ConnectionStatus>('disconnected')

  // 处理 WebSocket 消息
  const handleMessage = (message: WSMessage) => {
    switch (message.type) {
      case 'init': {
        const data = message.data as WSInitData | null
        if (data && 'current' in data) {
          currentSubtitle.value = data.current
            ? {
                text: data.current,
                enText: '',
                version: 0,
                enVersion: 0,
                startTime: Date.now(),
              }
            : null
          confirmedSubtitles.value = data.confirmed || []
        }
        break
      }

      case 'current': {
        const data = message.data as WSCurrentData | null
        if (data && 'text' in data) {
          if (data.version > currentVersion.value) {
            currentVersion.value = data.version
            currentSubtitle.value = {
              text: data.text,
              enText: data.enText || currentSubtitle.value?.enText || '',
              version: data.version,
              enVersion: data.enVersion || currentEnVersion.value,
              startTime: Date.now(),
            }
          }

          if (data.enText && data.enVersion > currentEnVersion.value) {
            currentEnVersion.value = data.enVersion
            if (currentSubtitle.value) {
              currentSubtitle.value.enText = data.enText
              currentSubtitle.value.enVersion = data.enVersion
            }
          }
        }
        break
      }

      case 'confirmed': {
        const data = message.data as WSConfirmedData | null
        if (data && 'id' in data) {
          const existingIndex = confirmedSubtitles.value.findIndex((s) => s.id === data.id)

          if (existingIndex !== -1) {
            const existing = confirmedSubtitles.value[existingIndex]
            existing.optimizedText = data.optimizedText
            existing.enText = data.enText
          } else {
            const newSubtitle: ConfirmedSubtitle = {
              id: data.id,
              text: data.text,
              optimizedText: data.optimizedText,
              enText: data.enText,
              timestamp: Date.now(),
            }
            confirmedSubtitles.value.push(newSubtitle)
            currentSubtitle.value = null
            currentVersion.value = 0
            currentEnVersion.value = 0
          }
        }
        break
      }

      case 'ai-processed': {
        const data = message.data as WSAIProcessedData | null
        if (data && 'id' in data) {
          const existing = confirmedSubtitles.value.find((s) => s.id === data.id)
          if (existing) {
            existing.optimizedText = data.optimizedText
            existing.enText = data.enText
          }
        }
        break
      }

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
    },
  }
}
