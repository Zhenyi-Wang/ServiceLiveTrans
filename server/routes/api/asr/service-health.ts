import { getASRServiceHealth, getProcessInfo } from '../../../utils/asr-process'

export default defineEventHandler(async () => {
  const health = await getASRServiceHealth()
  const processInfo = getProcessInfo()

  return {
    ...health,
    process: processInfo,
  }
})
