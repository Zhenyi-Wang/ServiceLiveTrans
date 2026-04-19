import { transcriptionState } from '../../utils/transcription-state'
import { getConnectionCount } from '../../utils/websocket'

export default defineEventHandler(() => {
  return {
    isActive: transcriptionState.isActive,
    source: transcriptionState.source,
    connectionCount: getConnectionCount(),
    subtitleCount: transcriptionState.confirmedSubtitles.length
  }
})
