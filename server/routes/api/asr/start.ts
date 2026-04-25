import { startASR, getASRStatus } from '../../../utils/asr-bridge'
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

  // spawn ASR 进程（如果未运行）
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

  const asrStatus = getASRStatus()
  if (asrStatus.isActive) {
    throw createError({
      statusCode: 409,
      statusMessage: 'ASR is already running'
    })
  }

  const url = process.env.ASR_WS_URL || 'ws://localhost:9900'
  startASR(
    { url, provider: provider || 'gguf', model: model || '' },
    (source || 'mic') as 'mic' | 'stream',
    streamUrl
  )

  return {
    success: true,
    spawned,
    provider,
    source: source || 'mic'
  }
})
