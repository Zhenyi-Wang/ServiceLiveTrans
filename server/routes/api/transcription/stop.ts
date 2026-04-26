import { orchestrator } from '../../../utils/transcription-orchestrator'

export default defineEventHandler(async () => {
  await orchestrator.stop()
  return { success: true }
})
