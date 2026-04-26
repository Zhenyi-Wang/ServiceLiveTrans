import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(() => {
  const status = transcriptionManager.getStatus()
  return {
    state: status.state,
    bridgeStatus: status.asrConnected ? 'connected' : 'disconnected',
    provider: status.asrProvider,
    modelLoaded: status.asrConnected,
    source: status.source
  }
})
