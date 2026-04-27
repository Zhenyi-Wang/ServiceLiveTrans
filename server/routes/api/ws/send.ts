import type { WSMessage, WSMessageType } from '../../../types/websocket'
import { broadcast } from '../../../utils/websocket'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    type: WSMessageType
    data?: unknown
  }>(event)

  if (!body.type) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing message type',
    })
  }

  const validTypes: WSMessageType[] = ['init', 'confirmed', 'current', 'clear']

  if (!validTypes.includes(body.type)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid message type: ${body.type}`,
    })
  }

  const message: WSMessage = {
    type: body.type,
    data: body.data ?? null,
  }

  broadcast(message)

  return {
    success: true,
    message: `Message of type '${body.type}' broadcast to ${1} client(s)`,
  }
})
