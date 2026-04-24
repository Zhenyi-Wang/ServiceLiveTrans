import { liveTransManager } from '../../../utils/live-trans-manager'

export default defineEventHandler(() => {
  return liveTransManager.getStatus()
})
