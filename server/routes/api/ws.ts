import type { WSMessage } from '../../../types/websocket'
import { addConnection, removeConnection, sendTo } from '../../utils/websocket'
import { simulationState } from '../../utils/simulator'

export default defineWebSocketHandler({
  open(peer) {
    // 添加连接
    addConnection(peer)

    console.log(`WebSocket connected: ${peer}`)

    // 发送初始化消息
    const initMessage: WSMessage = {
      type: 'init',
      data: {
        active: simulationState.activeSubtitle,
        confirmed: simulationState.confirmedSubtitles
      }
    }
    sendTo(peer, initMessage)
  },

  close(peer) {
    // 移除连接
    removeConnection(peer)
    console.log(`WebSocket disconnected: ${peer}`)
  },

  error(peer, error) {
    console.error(`WebSocket error: ${error}`)
    removeConnection(peer)
  }
})
