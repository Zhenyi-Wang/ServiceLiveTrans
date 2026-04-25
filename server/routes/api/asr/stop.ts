import { transcriptionManager } from '../../../utils/transcription-manager'

export default defineEventHandler(() => {
  transcriptionManager.stop()
  return { success: true, message: 'ASR stopped' }
})
