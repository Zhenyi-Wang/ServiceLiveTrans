import { getASRConfig } from '../../../utils/asr-process'

export default defineEventHandler(async () => {
  return getASRConfig()
})
