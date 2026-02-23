/**
 * 正在转录的字幕
 * 表示当前正在进行的字幕，只有原始文本和实时翻译
 */
export interface ActiveSubtitle {
  /** 原始转录文本 */
  rawText: string
  /** 实时翻译文本（模拟生成） */
  translatedText: string
  /** 开始时间戳 */
  startTime: number
}

/**
 * 已确认的字幕
 * 表示已完成确认的字幕，包含优化后的版本
 */
export interface ConfirmedSubtitle {
  /** 唯一标识符 */
  id: string
  /** 原始转录文本 */
  rawText: string
  /** 优化后的文本（AI纠正后） */
  optimizedText: string
  /** 翻译文本 */
  translatedText: string
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
