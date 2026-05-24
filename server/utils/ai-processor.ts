import type { AIResult } from '~/types/ai'
import { getAIConfig } from './ai-config'

function stripMarkdownFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
}

async function callAI(systemPrompt: string, userText: string): Promise<string> {
  const config = getAIConfig()
  const baseUrl = config.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1'
  const apiKey = config.apiKey || process.env.AI_API_KEY
  const model = config.modelName || process.env.AI_MODEL_NAME || 'gpt-4o-mini'

  if (!apiKey) {
    throw new Error('AI API Key not configured')
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`AI API error ${response.status}: ${errorBody.substring(0, 200)}`)
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[]
  }
  return data.choices[0].message.content
}

export async function processAI(text: string): Promise<AIResult> {
  const config = getAIConfig()

  if (!config.polishEnabled && !config.translationEnabled) {
    return { optimizedText: text, enText: '' }
  }

  try {
    if (config.polishEnabled && config.translationEnabled) {
      const raw = await callAI(
        '润色并翻译以下文本。只返回 JSON，不要任何解释或 markdown 标记：{"optimizedText":"润色后的文本","enText":"英文翻译"}',
        text,
      )
      const parsed = JSON.parse(stripMarkdownFence(raw)) as {
        optimizedText?: string
        enText?: string
      }
      return {
        optimizedText: parsed.optimizedText || text,
        enText: parsed.enText || '',
      }
    }

    if (config.polishEnabled) {
      const result = await callAI('润色以下文本，只返回润色后的结果，不要任何解释。', text)
      return { optimizedText: result.trim(), enText: '' }
    }

    const result = await callAI('将以下文本翻译为英文，只返回翻译结果，不要任何解释。', text)
    return { optimizedText: text, enText: result.trim() }
  } catch (e) {
    console.error('[AIProcessor] AI 处理失败:', e instanceof Error ? e.message : e)
    return { optimizedText: text, enText: '' }
  }
}
