import { orchestrator } from '../../../utils/transcription-orchestrator'
import type { SourceType } from '../../../utils/transcription-manager'

const VALID_SOURCES = ['mic', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { source, streamUrl } = body

  if (!source || !VALID_SOURCES.includes(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`,
    })
  }

  const result = await orchestrator.startAudioOnly({
    source: source as SourceType,
    streamUrl,
  })

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: result.error || '启动音频源失败',
    })
  }

  return { success: true, source }
})
