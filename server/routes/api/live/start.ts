import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { sourceType, streamUrl } = body

  if (!sourceType || !['flv', 'mic'].includes(sourceType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType must be "flv" or "mic"'
    })
  }

  if (transcriptionManager.isActive()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Transcription already running'
    })
  }

  const result = await transcriptionManager.start({
    provider: 'gguf',
    model: '',
    source: 'stream',
    streamUrl
  })

  return { success: result.success, sourceType }
})
