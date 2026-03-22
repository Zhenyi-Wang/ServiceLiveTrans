/**
 * WebSocket 消息类型
 */
export type WSMessageType = 'init' | 'confirmed' | 'current' | 'clear'

/**
 * 初始化消息数据
 */
export interface WSInitData {
  current: string | null  // 当前正在转录的中文
  confirmed: ConfirmedSubtitle[]
}

/**
 * 已确认字幕消息数据
 */
export interface WSConfirmedData {
  id: string
  text: string           // 中文原文
  optimizedText: string  // AI 优化后的中文
  enText: string         // 英文翻译
}

/**
 * 当前输入消息数据
 */
export interface WSCurrentData {
  text: string           // 纯中文
  enText: string         // 英文翻译（异步返回）
  version: number        // 中文版本号（用于竞态处理）
  enVersion: number      // 英文版本号（单独判断，有新翻译时更新）
}

/**
 * 已确认字幕
 */
export interface ConfirmedSubtitle {
  id: string
  text: string           // 中文原文
  optimizedText?: string  // AI 优化后的中文（可选）
  enText?: string         // 英文翻译（可选）
  timestamp: number
}

/**
 * WebSocket 消息
 */
export interface WSMessage {
  type: WSMessageType
  data?: WSInitData | WSConfirmedData | WSCurrentData | null
}
