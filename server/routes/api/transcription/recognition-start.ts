import { orchestrator } from '../../../utils/transcription-orchestrator'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { provider, model, overlapSec, memoryChunks } = body

  const result = await orchestrator.startRecognitionOnly({
    provider,
    model,
    overlapSec,
    memoryChunks,
  })

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: result.error || '启动识别服务失败'
    })
  }

  return { success: true }
})
