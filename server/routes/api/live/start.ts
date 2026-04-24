import { liveTransManager } from '../../../utils/live-trans-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { sourceType, streamUrl } = body

  if (!sourceType || !['flv', 'mic'].includes(sourceType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType must be "flv" or "mic"'
    })
  }

  const status = liveTransManager.getStatus()
  if (status.state !== 'idle') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Live transcription already running'
    })
  }

  const success = await liveTransManager.start({ sourceType, streamUrl })

  return {
    success,
    sourceType
  }
})
