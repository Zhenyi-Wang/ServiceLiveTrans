import { getStatus } from '../../utils/simulator'
import { getConnectionCount } from '../../utils/websocket'

export default defineEventHandler(() => {
  const status = getStatus()

  return {
    ...status,
    connectionCount: getConnectionCount()
  }
})
