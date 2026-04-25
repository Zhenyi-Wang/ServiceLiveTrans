import { stopASR } from '../../../utils/asr-bridge'
import { stopASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(() => {
  stopASR()
  stopASRProcess()
  return { success: true, message: 'ASR stopped' }
})
