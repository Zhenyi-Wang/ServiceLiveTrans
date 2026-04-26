import { stopASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(() => {
  stopASRProcess()
  return { success: true }
})
