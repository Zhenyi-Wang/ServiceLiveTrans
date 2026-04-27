import { orchestrator } from '../../../utils/transcription-orchestrator'
import type { ASRConfig } from '../../../../types/asr'

const VALID_SOURCES = ['mic', 'stream'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { source, streamUrl, ...asrConfig } = body as { source?: string; streamUrl?: string } & ASRConfig

  if (source && !VALID_SOURCES.includes(source as typeof VALID_SOURCES[number])) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`
    })
  }

  if (orchestrator.isActive()) {
    throw createError({
      statusCode: 409,
      statusMessage: '转录正在运行或操作中'
    })
  }

  const result = await orchestrator.start({
    source: (source || 'mic') as typeof VALID_SOURCES[number],
    streamUrl,
    ...asrConfig,
  })

  if (!result.success) {
    throw createError({
      statusCode: 500,
      statusMessage: result.error || '启动失败'
    })
  }

  return { success: true, source: source || 'mic' }
})
