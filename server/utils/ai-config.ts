import type { AIConfig } from '~/types/ai'
import { getConfig, initDefaults, setConfig } from './db'

const KEYS = {
  baseUrl: 'ai_base_url',
  apiKey: 'ai_api_key',
  modelName: 'ai_model_name',
  polishEnabled: 'ai_polish_enabled',
  translationEnabled: 'ai_translation_enabled',
} as const

const DEFAULTS: Record<string, unknown> = {
  [KEYS.baseUrl]: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  [KEYS.apiKey]: process.env.AI_API_KEY || '',
  [KEYS.modelName]: process.env.AI_MODEL_NAME || '',
  [KEYS.polishEnabled]: false,
  [KEYS.translationEnabled]: false,
}

initDefaults(DEFAULTS)

export function getAIConfig(): AIConfig {
  return {
    baseUrl: getConfig<string>(KEYS.baseUrl, DEFAULTS[KEYS.baseUrl] as string),
    apiKey: getConfig<string>(KEYS.apiKey, DEFAULTS[KEYS.apiKey] as string),
    modelName: getConfig<string>(KEYS.modelName, DEFAULTS[KEYS.modelName] as string),
    polishEnabled: getConfig<boolean>(KEYS.polishEnabled, false),
    translationEnabled: getConfig<boolean>(KEYS.translationEnabled, false),
  }
}

export function saveAIConfig(partial: Partial<AIConfig>): AIConfig {
  if (partial.baseUrl !== undefined) setConfig(KEYS.baseUrl, partial.baseUrl)
  if (partial.apiKey !== undefined) setConfig(KEYS.apiKey, partial.apiKey)
  if (partial.modelName !== undefined) setConfig(KEYS.modelName, partial.modelName)
  if (partial.polishEnabled !== undefined) setConfig(KEYS.polishEnabled, partial.polishEnabled)
  if (partial.translationEnabled !== undefined)
    setConfig(KEYS.translationEnabled, partial.translationEnabled)
  return getAIConfig()
}
