import { stopASR } from '../../../utils/asr-bridge'
import { liveTransManager } from '../../../utils/live-trans-manager'
import { stopASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(() => {
  const liveStatus = liveTransManager.getStatus()
  if (liveStatus.state !== 'idle') {
    liveTransManager.stop()
  } else {
    stopASR()
  }
  stopASRProcess()
  return { success: true, message: 'ASR stopped' }
})
