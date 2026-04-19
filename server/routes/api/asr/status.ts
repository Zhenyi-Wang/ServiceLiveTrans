import { getASRStatus } from '../../../utils/asr-bridge'

export default defineEventHandler(() => {
  return getASRStatus()
})
