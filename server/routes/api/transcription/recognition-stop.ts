import { orchestrator } from '../../../utils/transcription-orchestrator'

export default defineEventHandler(async () => {
  await orchestrator.stopRecognitionOnly()
  return { success: true }
})
