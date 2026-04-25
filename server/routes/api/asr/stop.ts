import { transcriptionManager } from '../../../utils/transcription-manager'
import { stopASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(() => {
  transcriptionManager.stop()
  stopASRProcess()
  return { success: true, message: 'ASR stopped' }
})
