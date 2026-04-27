import type { Peer } from 'crossws'
import type { WSMessage } from '../../types/websocket'

/**
 * 全局 WebSocket 连接管理
 * 使用 peer 对象存储连接
 */

// 存储所有活跃的 WebSocket 连接
const activeConnections = new Set<Peer>()

/**
 * 添加连接到管理器
 */
export function addConnection(peer: Peer) {
  activeConnections.add(peer)
  broadcastConnectionCount()
}

/**
 * 从管理器移除连接
 */
export function removeConnection(peer: Peer) {
  activeConnections.delete(peer)
  broadcastConnectionCount()
}

function broadcastConnectionCount() {
  broadcast({
    type: 'connection-count',
    data: { count: activeConnections.size },
  })
}

/**
 * 获取当前连接数
 */
export function getConnectionCount(): number {
  return activeConnections.size
}

/**
 * 广播消息到所有连接的客户端
 */
export function broadcast(message: WSMessage) {
  const messageStr = JSON.stringify(message)
  for (const peer of activeConnections) {
    try {
      peer.send(messageStr)
    } catch (error) {
      console.error('Failed to send message to peer:', error)
    }
  }
}

/**
 * 发送消息到指定客户端
 */
export function sendTo(peer: Peer, message: WSMessage) {
  try {
    peer.send(JSON.stringify(message))
  } catch (error) {
    console.error('Failed to send message to peer:', error)
  }
}
