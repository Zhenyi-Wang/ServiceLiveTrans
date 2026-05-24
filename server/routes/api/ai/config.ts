import type { AIConfig } from '~/types/ai'
import { getAIConfig, saveAIConfig } from '~/server/utils/ai-config'

export default defineEventHandler(async (event) => {
  if (event.method === 'GET') {
    const config = getAIConfig()
    return {
      ...config,
      // 返回时脱敏 apiKey
      apiKeyConfigured: !!config.apiKey,
      apiKeyHint: config.apiKey ? config.apiKey.slice(0, 4) + '****' + config.apiKey.slice(-4) : '',
    }
  }

  if (event.method === 'POST') {
    const body = (await readBody(event)) as Partial<AIConfig>

    const stringFields = ['baseUrl', 'apiKey', 'modelName'] as const
    for (const field of stringFields) {
      if (body[field] !== undefined && typeof body[field] !== 'string') {
        throw createError({ statusCode: 400, statusMessage: `${field} must be a string` })
      }
    }

    const boolFields = ['polishEnabled', 'translationEnabled'] as const
    for (const field of boolFields) {
      if (body[field] !== undefined && typeof body[field] !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: `${field} must be a boolean` })
      }
    }

    const config = saveAIConfig(body)
    return {
      ...config,
      apiKeyConfigured: !!config.apiKey,
      apiKeyHint: config.apiKey ? config.apiKey.slice(0, 4) + '****' + config.apiKey.slice(-4) : '',
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
})
