import { stopASR } from '../../../utils/asr-bridge'

export default defineEventHandler(() => {
  stopASR()
  return { success: true, message: 'ASR stopped' }
})
