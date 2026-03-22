import type { CurrentSubtitle, ConfirmedSubtitle } from '../../types/subtitle'
import type { SimulationState } from '../../types/simulation'
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
 * 获取随机延迟
 */
function getRandomDelay(): number {
  const base = simulationState.optimizationDelay
  const range = simulationState.delayRandomRange
  return base + (Math.random() * 2 - 1) * range
}

/**
 * 生成字幕：逐字输出模拟
 * current 阶段只发中文，英文通过异步翻译返回
 */
function startCharacterSimulation(sentence: { chinese: string; english: string }) {
  let charIndex = 0
  const chineseChars = sentence.chinese.split('')
  let chineseVersion = 0
  let englishVersion = 0

  // 清除之前的字符定时器
  if (characterTimer) {
    clearTimeout(characterTimer)
    characterTimer = null
  }

  // 模拟异步翻译
  const simulateAsyncTranslation = () => {
    if (!simulationState.isRunning) return

    englishVersion++
    broadcast({
      type: 'current',
      data: {
        text: chineseChars.join(''),
        enText: sentence.english,
        version: chineseVersion,
        enVersion: englishVersion
      }
    })
  }

  // 逐字输出
  const outputNextChar = () => {
    if (!simulationState.isRunning) {
      return
    }

    if (charIndex < chineseChars.length) {
      const currentText = chineseChars.slice(0, charIndex + 1).join('')
      chineseVersion++

      simulationState.currentSubtitle = {
        text: currentText,
        enText: '',
        version: chineseVersion,
        enVersion: 0,
        startTime: Date.now()
      }

      // current：只发中文，英文为空，触发异步翻译
      broadcast({
        type: 'current',
        data: {
          text: currentText,
          enText: '',
          version: chineseVersion,
          enVersion: 0
        }
      })

      // 模拟异步翻译（延迟返回）
      setTimeout(() => {
        if (!simulationState.isRunning) return
        simulateAsyncTranslation()
      }, 500 + Math.random() * 500)

      charIndex++
      characterTimer = setTimeout(outputNextChar, 100 + Math.random() * 100)
    } else {
      // 字幕完成，发送 confirmed
      confirmSubtitle(sentence)
    }
  }

  outputNextChar()
}

/**
 * 确认字幕：发送原始文本，发起 AI 请求
 */
function confirmSubtitle(sentence: { chinese: string; english: string }) {
  const id = generateId()

  // 清空当前输入
  simulationState.currentSubtitle = null

  // 创建字幕并添加到列表
  const confirmedSubtitle: ConfirmedSubtitle = {
    id,
    text: sentence.chinese,
    timestamp: Date.now()
  }
  simulationState.confirmedSubtitles.push(confirmedSubtitle)

  // 发送 confirmed（原始文本，优化和翻译为空）
  broadcast({
    type: 'confirmed',
    data: {
      id,
      text: sentence.chinese,
      optimizedText: '',
      enText: ''
    }
  })

  // 模拟 AI 优化+翻译（延迟后返回）
  const aiDelay = getRandomDelay()
  setTimeout(() => {
    if (!simulationState.isRunning) return

    const optimizedText = simulateOptimization(sentence.chinese)

    // 更新字幕状态
    const subtitle = simulationState.confirmedSubtitles.find(s => s.id === id)
    if (subtitle) {
      subtitle.optimizedText = optimizedText
      subtitle.enText = sentence.english
    }

    // 发送更新后的 confirmed
    broadcast({
      type: 'confirmed',
      data: {
        id,
        text: sentence.chinese,
        optimizedText,
        enText: sentence.english
      }
    })
  }, aiDelay)

  // 继续下一个字幕
  if (simulationState.isRunning) {
    simulationTimer = setTimeout(() => {
      if (simulationState.isRunning) {
        const nextSentence = getRandomSentence()
        startCharacterSimulation(nextSentence)
      }
    }, 1500 + Math.random() * 1000)
  }
}

/**
 * 模拟文本优化
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

  if (delay !== undefined) {
    simulationState.optimizationDelay = delay
  }

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
