import type { CurrentSubtitle, ConfirmedSubtitle } from '~/types/subtitle'
import type { WSMessage } from '~/types/websocket'
import type { ConnectionStatus } from './useWebSocket'

export type LanguageMode = 'chinese' | 'english' | 'bilingual'

export function useSubtitles() {
  // 字幕状态
  const currentSubtitle = ref<CurrentSubtitle | null>(null)  // 当前输入（中文）
  const confirmedSubtitles = ref<ConfirmedSubtitle[]>([])     // 已确认字幕列表
  const currentVersion = ref(0)       // 当前英文版本号（用于竞态处理）

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
          currentSubtitle.value = data.current ? { text: data.current, startTime: Date.now() } : null
          confirmedSubtitles.value = data.confirmed || []
        }
        break

      case 'current':
        // 当前输入更新（包含中文、英文翻译和版本号）
        if (message.data && 'text' in message.data) {
          const data = message.data as any
          // 竞态处理：只有版本号大于等于当前版本才更新
          if (data.version >= currentVersion.value) {
            currentVersion.value = data.version
            currentSubtitle.value = {
              text: data.text,
              enText: data.enText,
              startTime: Date.now()
            }
          }
        }
        break

      case 'confirmed':
        // 已确认字幕（包含完整数据）
        if (message.data && 'id' in message.data) {
          const data = message.data as any
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
        }
        break

      case 'clear':
        // 清空所有字幕
        currentSubtitle.value = null
        confirmedSubtitles.value = []
        currentVersion.value = 0
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
