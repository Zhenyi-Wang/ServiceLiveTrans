import type { ActiveSubtitle, ConfirmedSubtitle } from '~/types/subtitle'
import type { WSMessage } from '~/types/websocket'
import type { ConnectionStatus } from './useWebSocket'

export type LanguageMode = 'chinese' | 'english' | 'bilingual'

export function useSubtitles() {
  // 字幕状态
  const activeSubtitle = ref<ActiveSubtitle | null>(null)
  const confirmedSubtitles = ref<ConfirmedSubtitle[]>([])

  // 语言模式（持久化到 localStorage）
  const languageMode = useLocalStorage<LanguageMode>('languageMode', 'bilingual')

  // 连接状态
  const connectionStatus = ref<ConnectionStatus>('disconnected')

  // 处理 WebSocket 消息
  const handleMessage = (message: WSMessage) => {
    switch (message.type) {
      case 'init':
        if (message.data && 'active' in message.data) {
          activeSubtitle.value = message.data.active
          confirmedSubtitles.value = message.data.confirmed
        }
        break

      case 'active':
        if (message.data && 'rawText' in message.data) {
          activeSubtitle.value = {
            rawText: message.data.rawText,
            translatedText: message.data.translatedText,
            startTime: Date.now()
          }
        }
        break

      case 'confirmed':
        if (message.data && 'id' in message.data) {
          // 添加新确认的字幕
          const newSubtitle = message.data as ConfirmedSubtitle
          confirmedSubtitles.value.push(newSubtitle)
          // 清空正在转录的字幕
          activeSubtitle.value = null
        }
        break

      case 'optimized':
        if (message.data && 'id' in message.data) {
          // 更新已确认字幕的优化版本
          const index = confirmedSubtitles.value.findIndex(s => s.id === message.data!.id)
          if (index !== -1 && message.data && 'optimizedText' in message.data) {
            confirmedSubtitles.value[index].optimizedText = message.data.optimizedText as string
            confirmedSubtitles.value[index].translatedText = message.data.translatedText as string
          }
        }
        break

      case 'clear':
        // 清空所有字幕
        activeSubtitle.value = null
        confirmedSubtitles.value = []
        break
    }
  }

  // 设置语言模式
  const setLanguageMode = (mode: LanguageMode) => {
    languageMode.value = mode
  }

  // 清空字幕
  const clearSubtitles = () => {
    activeSubtitle.value = null
    confirmedSubtitles.value = []
  }

  return {
    // 状态
    activeSubtitle: readonly(activeSubtitle),
    confirmedSubtitles: readonly(confirmedSubtitles),
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
