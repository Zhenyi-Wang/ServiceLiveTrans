import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(() => {
  const status = transcriptionManager.getStatus()
  return {
    isActive: status.state !== 'idle',
    bridgeStatus: status.asrConnected ? 'connected' : 'disconnected',
    provider: status.asrProvider,
    modelLoaded: status.asrConnected,
    source: status.source
  }
})
