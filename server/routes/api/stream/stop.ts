import { stopStream } from '../../../utils/stream-manager'

export default defineEventHandler(() => {
  stopStream()
  return { success: true, message: 'Stream stopped' }
})
