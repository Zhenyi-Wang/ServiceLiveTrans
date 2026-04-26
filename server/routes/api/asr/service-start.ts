import { startASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(async () => {
  const result = await startASRProcess()
  return { success: !!result, pid: result?.pid ?? null }
})
