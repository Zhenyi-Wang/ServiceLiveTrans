/**
 * 正在转录的字幕（当前输入）
 */
export interface CurrentSubtitle {
  /** 当前转录文本（中文） */
  text: string
  /** 英文翻译 */
  enText?: string
  /** 开始时间戳 */
  startTime: number
}

/**
 * 已确认的字幕
 */
export interface ConfirmedSubtitle {
  /** 唯一标识符 */
  id: string
  /** 中文原文 */
  text: string
  /** AI 优化后的中文（可选） */
  optimizedText?: string
  /** 英文翻译 */
  enText?: string
  /** 创建时间戳 */
  timestamp: number
}

/**
 * 用户偏好设置
 */
export interface UserPreference {
  /** 语言显示模式 */
  languageMode: 'chinese' | 'english' | 'bilingual'
  /** 字体大小 (rem) */
  fontSize: number
}
