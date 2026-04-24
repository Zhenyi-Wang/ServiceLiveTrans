/**
 * 直播转录状态
 */
export type LiveTransState = 'idle' | 'connecting' | 'running' | 'reconnecting'

/**
 * WebSocket 消息类型
 */
export type WSMessageType = 'init' | 'confirmed' | 'current' | 'clear' | 'status' | 'ai-processed'

/**
 * 初始化消息数据
 */
export interface WSInitData {
  current: string | null
  confirmed: ConfirmedSubtitle[]
}

/**
 * 已确认字幕消息数据
 */
export interface WSConfirmedData {
  id: string
  text: string
  optimizedText: string
  enText: string
}

/**
 * 当前输入消息数据
 */
export interface WSCurrentData {
  text: string
  enText: string
  version: number
  enVersion: number
}

/**
 * 直播转录状态变化通知
 */
export interface WSStatusData {
  state: LiveTransState
  error?: string
  reconnectCount?: number
}

/**
 * AI 后处理完成通知
 */
export interface WSAIProcessedData {
  id: string
  optimizedText: string
  enText: string
}

/**
 * 已确认字幕
 */
export interface ConfirmedSubtitle {
  id: string
  text: string
  optimizedText?: string
  enText?: string
  timestamp: number
}

/**
 * WebSocket 消息
 */
export interface WSMessage {
  type: WSMessageType
  data?: WSInitData | WSConfirmedData | WSCurrentData | WSStatusData | WSAIProcessedData | null
}
