import { transcriptionManager } from '../../../utils/transcription-manager'

const VALID_SOURCES = ['mic', 'file', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { provider, model, source, streamUrl } = body

  if (source && !VALID_SOURCES.includes(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    })
  }

  if (transcriptionManager.isActive()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Transcription already running'
    })
  }

  const resolvedSource = (source || 'mic') as typeof VALID_SOURCES[number]

  const result = await transcriptionManager.start({
    provider: provider || 'gguf',
    model: model || '',
    source: resolvedSource,
    streamUrl
  })

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: '转录启动失败'
    })
  }

  return {
    success: true,
    spawned: result.spawned,
    provider,
    source: resolvedSource
  }
})
