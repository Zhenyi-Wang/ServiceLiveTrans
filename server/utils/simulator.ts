import type { ActiveSubtitle, ConfirmedSubtitle } from '../../types/subtitle'
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
  const englishWords = sentence.english.split(' ')

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
      // 更新正在转录的字幕
      const currentChinese = chineseChars.slice(0, charIndex + 1).join('')
      const currentEnglish = englishWords.slice(0, Math.min(Math.floor((charIndex + 1) / 2), englishWords.length)).join(' ')

      simulationState.activeSubtitle = {
        rawText: currentChinese,
        translatedText: currentEnglish,
        startTime: Date.now()
      }

      // 广播更新
      broadcast({
        type: 'active',
        data: {
          rawText: currentChinese,
          translatedText: currentEnglish
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

  // 创建已确认字幕（原始版本先推送）
  const confirmedSubtitle: ConfirmedSubtitle = {
    id,
    rawText: sentence.chinese,
    optimizedText: sentence.chinese, // 初始等于原文
    translatedText: sentence.english,
    timestamp
  }

  // 添加到确认列表
  simulationState.confirmedSubtitles.push(confirmedSubtitle)
  simulationState.activeSubtitle = null

  // 广播确认消息
  broadcast({
    type: 'confirmed',
    data: confirmedSubtitle
  })

  // 延迟后发送优化版本
  const delay = getRandomDelay()
  setTimeout(() => {
    // 模拟优化（这里只是简单地添加一些标点或小修改）
    const optimized = simulateOptimization(sentence.chinese)

    // 更新已确认字幕的优化文本
    const subtitle = simulationState.confirmedSubtitles.find(s => s.id === id)
    if (subtitle) {
      subtitle.optimizedText = optimized
    }

    // 广播优化更新
    broadcast({
      type: 'optimized',
      data: {
        id,
        optimizedText: optimized,
        translatedText: sentence.english
      }
    })
  }, delay)

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
 * 模拟文本优化（演示用途）
 */
function simulateOptimization(text: string): string {
  // 简单模拟：有时添加标点或调整格式
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

  simulationState.activeSubtitle = null
}

/**
 * 清空所有字幕
 */
export function clearSubtitles(): void {
  simulationState.confirmedSubtitles = []
  simulationState.activeSubtitle = null

  // 广播清空消息
  broadcast({ type: 'clear' })
}

/**
 * 获取当前状态
 */
export function getStatus() {
  return {
    isRunning: simulationState.isRunning,
    connectionCount: 0, // 将由 API 路由填充
    subtitleCount: simulationState.confirmedSubtitles.length,
    config: {
      optimizationDelay: simulationState.optimizationDelay,
      delayRandomRange: simulationState.delayRandomRange
    }
  }
}
