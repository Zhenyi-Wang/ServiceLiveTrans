import type { AIResult } from '~/types/ai'

let useMockAI = true

export function setMockAI(enabled: boolean): void {
  useMockAI = enabled
}

export function isMockAI(): boolean {
  return useMockAI
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function mockProcess(text: string): Promise<AIResult> {
  await delay(500 + Math.random() * 1000)

  return {
    optimizedText: `润色：${text}`,
    enText: `翻译：${text}`
  }
}

async function realProcess(text: string): Promise<AIResult> {
  // TODO: 接入真实 AI API
  return { optimizedText: text, enText: '' }
}

export async function processAI(text: string): Promise<AIResult> {
  if (useMockAI) {
    return mockProcess(text)
  }
  return realProcess(text)
}
