import type { WSMessage } from '../../../types/websocket'
import { addConnection, removeConnection, sendTo } from '../../utils/websocket'
import { transcriptionState } from '../../utils/transcription-state'

export default defineWebSocketHandler({
  open(peer) {
    addConnection(peer)
    console.log(`WebSocket connected: ${peer}`)

    const initMessage: WSMessage = {
      type: 'init',
      data: {
        current: transcriptionState.currentSubtitle?.text ?? null,
        confirmed: transcriptionState.confirmedSubtitles
      }
    }
    sendTo(peer, initMessage)
  },

  close(peer) {
    removeConnection(peer)
    console.log(`WebSocket disconnected: ${peer}`)
  },

  error(peer, error) {
    console.error(`WebSocket error: ${error}`)
    removeConnection(peer)
  }
})
