import { orchestrator } from '../../../utils/transcription-orchestrator'

export default defineEventHandler(async () => {
  await orchestrator.stopAudioOnly()
  return { success: true }
})
