import { transcriptionState } from '../../utils/transcription-state'
import { getConnectionCount } from '../../utils/websocket'

/**
 * GET /devapi/state
 * 完整转录状态（当前字幕 + 所有已确认字幕 + 连接数）
 */
export default defineEventHandler(() => {
  return {
    ...transcriptionState,
    connectionCount: getConnectionCount(),
  }
})
