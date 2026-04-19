import { startStream, isStreamRunning } from '../../../utils/stream-manager'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { url } = body

  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing url parameter'
    })
  }

  if (isStreamRunning()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Stream is already running'
    })
  }

  const success = startStream(url)

  return {
    success: true,
    message: 'Stream started',
    url
  }
})
