import type { CurrentSubtitle, ConfirmedSubtitle } from '../../types/subtitle'
import type { SimulationState } from '../../types/simulation'
import type { WSMessage } from '../../types/websocket'
import { DEFAULT_SIMULATION_STATE } from '../../types/simulation'
import { getRandomSentence } from './sample-data'
import { broadcast } from './websocket'

/**
 * 全局模拟状态
 */
export const simulationState: SimulationState = { ...DEFAULT_SIMULATION_STATE }

/**
 * 英文版本号（用于竞态处理）
 */
let currentVersion = 0

/**
 * 模拟器定时器
 */
let simulationTimer: NodeJS.Timeout | null = null
let characterTimer: NodeJS.Timeout | null = null

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `subtitle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 获取随机延迟（基础延迟 ± 随机范围）
 */
function getRandomDelay(): number {
  const base = simulationState.optimizationDelay
  const range = simulationState.delayRandomRange
  return base + (Math.random() * 2 - 1) * range
}

/**
 * 生成字幕：逐字输出模拟
 */
function startCharacterSimulation(sentence: { chinese: string; english: string }) {
  let charIndex = 0
  const chineseChars = sentence.chinese.split('')

  // 清除之前的字符定时器
  if (characterTimer) {
    clearTimeout(characterTimer)
    characterTimer = null
  }

  // 逐字输出
  const outputNextChar = () => {
    if (!simulationState.isRunning) {
      return
    }

    if (charIndex < chineseChars.length) {
      // 当前中文文本
      const currentText = chineseChars.slice(0, charIndex + 1).join('')

      // 更新当前字幕状态
      simulationState.currentSubtitle = {
        text: currentText,
        startTime: Date.now()
      }

      // 模拟翻译
      const enText = simulateTranslation(currentText, sentence.english)
      currentVersion++

      // 广播 current 消息（包含中文、英文翻译和版本号）
      broadcast({
        type: 'current',
        data: {
          text: currentText,
          enText,
          version: currentVersion
        }
      })

      charIndex++
      characterTimer = setTimeout(outputNextChar, 100 + Math.random() * 100) // 100-200ms 每个字
    } else {
      // 字幕完成，确认并创建已确认字幕
      confirmSubtitle(sentence)
    }
  }

  outputNextChar()
}

/**
 * 确认字幕
 */
function confirmSubtitle(sentence: { chinese: string; english: string }) {
  const id = generateId()
  const timestamp = Date.now()

  // 模拟优化后的文本
  const optimizedText = simulateOptimization(sentence.chinese)

  // 创建已确认字幕
  const confirmedSubtitle: ConfirmedSubtitle = {
    id,
    text: sentence.chinese,
    optimizedText,
    enText: sentence.english,
    timestamp
  }

  // 添加到确认列表
  simulationState.confirmedSubtitles.push(confirmedSubtitle)
  simulationState.currentSubtitle = null

  // 广播 confirmed 消息（包含完整数据）
  broadcast({
    type: 'confirmed',
    data: {
      id,
      text: sentence.chinese,
      optimizedText,
      enText: sentence.english
    }
  })

  // 继续下一个字幕
  if (simulationState.isRunning) {
    simulationTimer = setTimeout(() => {
      if (simulationState.isRunning) {
        const nextSentence = getRandomSentence()
        startCharacterSimulation(nextSentence)
      }
    }, 1500 + Math.random() * 1000) // 1.5-2.5秒后开始下一句
  }
}

/**
 * 模拟翻译
 */
function simulateTranslation(currentText: string, fullEnglish: string): string {
  // 简单模拟：返回部分英文
  const englishWords = fullEnglish.split(' ')
  const charCount = currentText.length
  const wordCount = Math.ceil(charCount / 2)
  return englishWords.slice(0, wordCount).join(' ')
}

/**
 * 模拟文本优化（演示用途）
 */
function simulateOptimization(text: string): string {
  const optimizations = [
    text,
    text.endsWith('。') ? text : text + '。',
    text.replace(/，/g, ',').replace(/。/g, '.'),
    text
  ]
  return optimizations[Math.floor(Math.random() * optimizations.length)]
}

/**
 * 开始模拟
 */
export function startSimulation(delay?: number): boolean {
  if (simulationState.isRunning) {
    return false
  }

  simulationState.isRunning = true
  currentVersion = 0

  if (delay !== undefined) {
    simulationState.optimizationDelay = delay
  }

  // 立即开始第一个字幕
  const sentence = getRandomSentence()
  startCharacterSimulation(sentence)

  return true
}

/**
 * 停止模拟
 */
export function stopSimulation(): void {
  simulationState.isRunning = false

  if (simulationTimer) {
    clearTimeout(simulationTimer)
    simulationTimer = null
  }

  if (characterTimer) {
    clearTimeout(characterTimer)
    characterTimer = null
  }

  simulationState.currentSubtitle = null
}

/**
 * 清空所有字幕
 */
export function clearSubtitles(): void {
  simulationState.confirmedSubtitles = []
  simulationState.currentSubtitle = null

  // 广播清空消息
  broadcast({ type: 'clear' })
}

/**
 * 获取当前状态
 */
export function getStatus() {
  return {
    isRunning: simulationState.isRunning,
    connectionCount: 0,
    subtitleCount: simulationState.confirmedSubtitles.length,
    config: {
      optimizationDelay: simulationState.optimizationDelay,
      delayRandomRange: simulationState.delayRandomRange
    }
  }
}
