import { orchestrator } from '../../../utils/transcription-orchestrator'

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

  const result = await orchestrator.switchSource(
    source as (typeof VALID_SOURCES)[number],
    streamUrl,
  )

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: result.error || '切换失败',
    })
  }

  return { success: true, source }
})
