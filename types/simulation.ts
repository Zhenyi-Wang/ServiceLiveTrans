import type { ActiveSubtitle, ConfirmedSubtitle } from './subtitle'

/**
 * 模拟状态
 * 管理模拟器的运行状态和字幕数据
 */
export interface SimulationState {
  /** 是否正在运行 */
  isRunning: boolean
  /** 优化翻译延迟（毫秒） */
  optimizationDelay: number
  /** 延迟随机范围（毫秒） */
  delayRandomRange: number
  /** 当前正在转录的字幕 */
  activeSubtitle: ActiveSubtitle | null
  /** 已确认的字幕列表 */
  confirmedSubtitles: ConfirmedSubtitle[]
}

/**
 * 默认模拟状态
 */
export const DEFAULT_SIMULATION_STATE: SimulationState = {
  isRunning: false,
  optimizationDelay: 2000,
  delayRandomRange: 1000,
  activeSubtitle: null,
  confirmedSubtitles: []
}
