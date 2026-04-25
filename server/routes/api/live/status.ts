import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(() => {
  const status = transcriptionManager.getStatus()
  return {
    state: status.state,
    sourceType: status.source === 'stream' ? 'flv' : status.source,
    reconnectCount: status.sourceStatus?.reconnectCount ?? 0,
    uptime: status.uptime
  }
})
