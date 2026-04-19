import { startASR, getASRStatus } from '../../../utils/asr-bridge'

const VALID_PROVIDERS = ['whisper', 'funasr']
const VALID_SOURCES = ['mic', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { provider, model, source, streamUrl } = body

  if (!VALID_PROVIDERS.includes(provider)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`
    })
  }

  if (!VALID_SOURCES.includes(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    })
  }

  if (source === 'stream' && !streamUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'streamUrl is required when source is "stream"'
    })
  }

  const asrStatus = getASRStatus()
  if (asrStatus.isActive) {
    throw createError({
      statusCode: 409,
      statusMessage: 'ASR is already running'
    })
  }

  const url = process.env.ASR_WS_URL || 'ws://localhost:9900'
  const success = startASR(
    { url, provider, model: model || '' },
    source,
    streamUrl
  )

  return {
    success,
    message: success ? 'ASR started' : 'Failed to start ASR',
    provider,
    source
  }
})
