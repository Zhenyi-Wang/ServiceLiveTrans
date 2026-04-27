import { orchestrator } from '../../../utils/transcription-orchestrator'
import type { ASRConfig } from '../../../../types/asr'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const asrConfig = body as ASRConfig

  const result = await orchestrator.startRecognitionOnly(asrConfig)

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: result.error || '启动识别服务失败',
    })
  }

  return { success: true }
})
