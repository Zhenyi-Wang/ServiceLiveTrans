import { startASR, getASRStatus } from '../../../utils/asr-bridge'
import { startASRProcess } from '../../../utils/asr-process'
import { liveTransManager } from '../../../utils/live-trans-manager'

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

  const resolvedSource = (source || 'mic') as typeof VALID_SOURCES[number]

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

  // stream 源走 liveTransManager（包含 FLVSource 拉流 + ASR 桥接）
  if (resolvedSource === 'stream') {
    const liveStatus = liveTransManager.getStatus()
    if (liveStatus.state !== 'idle') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Live transcription already running'
      })
    }

    const success = await liveTransManager.start({ sourceType: 'flv', streamUrl })
    if (!success) {
      throw createError({
        statusCode: 500,
        statusMessage: '直播转录启动失败'
      })
    }

    return { success: true, spawned, provider, source: 'stream' }
  }

  // mic/file 源走原有 ASR Bridge
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
    resolvedSource as 'mic' | 'stream',
    streamUrl
  )

  return {
    success: true,
    spawned,
    provider,
    source: resolvedSource
  }
})
