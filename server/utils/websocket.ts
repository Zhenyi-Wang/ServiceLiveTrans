import type { WSMessage } from '../../types/websocket'

/**
 * 全局 WebSocket 连接管理
 * 使用 peer 对象存储连接
 */

// 存储所有活跃的 WebSocket 连接
const activeConnections = new Set<any>()

/**
 * 添加连接到管理器
 */
export function addConnection(peer: any) {
  activeConnections.add(peer)
}

/**
 * 从管理器移除连接
 */
export function removeConnection(peer: any) {
  activeConnections.delete(peer)
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
export function sendTo(peer: any, message: WSMessage) {
  try {
    peer.send(JSON.stringify(message))
  } catch (error) {
    console.error('Failed to send message to peer:', error)
  }
}
