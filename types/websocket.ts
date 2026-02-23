import type { ActiveSubtitle, ConfirmedSubtitle } from './subtitle'

/**
 * WebSocket 消息类型
 */
export type WSMessageType = 'init' | 'active' | 'confirmed' | 'optimized' | 'clear'

/**
 * 初始化消息数据
 */
export interface WSInitData {
  active: ActiveSubtitle | null
  confirmed: ConfirmedSubtitle[]
}

/**
 * 正在转录更新消息数据
 */
export interface WSActiveData {
  rawText: string
  translatedText: string
}

/**
 * 字幕确认消息数据
 */
export interface WSConfirmedData extends ConfirmedSubtitle {}

/**
 * 字幕优化更新消息数据
 */
export interface WSOptimizedData {
  id: string
  optimizedText: string
  translatedText: string
}

/**
 * WebSocket 消息
 */
export interface WSMessage {
  type: WSMessageType
  data?: WSInitData | WSActiveData | WSConfirmedData | WSOptimizedData | null
}

/**
 * 客户端连接信息
 */
export interface ClientConnection {
  /** 连接 ID */
  id: string
  /** 连接时间 */
  connectedAt: number
  /** 最后活动时间 */
  lastActivity: number
}
