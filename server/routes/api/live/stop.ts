import { liveTransManager } from '../../../utils/live-trans-manager'

export default defineEventHandler(() => {
  liveTransManager.stop()
  return { success: true }
})
