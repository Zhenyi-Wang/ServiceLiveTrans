import { transcriptionManager } from '../../../utils/transcription-manager'
import { startASRProcess } from '../../../utils/asr-process'

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

  let spawned = false
  try {
    const result = await startASRProcess()
    spawned = result !== null
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'ASR 进程启动失败'
    })
  }

  const success = await transcriptionManager.start({
    provider: provider || 'gguf',
    model: model || '',
    source: resolvedSource,
    streamUrl
  })

  if (!success) {
    throw createError({
      statusCode: 500,
      statusMessage: '转录启动失败'
    })
  }

  return {
    success: true,
    spawned,
    provider,
    source: resolvedSource
  }
})
