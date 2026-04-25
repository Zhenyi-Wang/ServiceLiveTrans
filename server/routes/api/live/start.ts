import { transcriptionManager } from '../../../utils/transcription-manager'
import { startASRProcess } from '../../../utils/asr-process'

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
    provider: 'gguf',
    model: '',
    source: 'stream',
    streamUrl
  })

  return { success, sourceType }
})
