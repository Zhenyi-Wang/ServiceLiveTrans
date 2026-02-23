import type { WSMessage } from '~/types/websocket'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface UseWebSocketOptions {
  onMessage?: (message: WSMessage) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  reconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10
  } = options

  const status = ref<ConnectionStatus>('disconnected')
  const ws = ref<WebSocket | null>(null)
  const reconnectAttempts = ref(0)
  const isReconnecting = ref(false)

  const connect = () => {
    if (import.meta.server) return

    status.value = 'connecting'

    // 构建 WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/ws`

    try {
      ws.value = new WebSocket(wsUrl)

      ws.value.onopen = () => {
        status.value = 'connected'
        reconnectAttempts.value = 0
        isReconnecting.value = false
        onOpen?.()
        console.log('WebSocket connected')
      }

      ws.value.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data)
          onMessage?.(message)
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      ws.value.onclose = () => {
        status.value = 'disconnected'
        onClose?.()
        console.log('WebSocket disconnected')

        // 自动重连
        if (reconnect && reconnectAttempts.value < maxReconnectAttempts && !isReconnecting.value) {
          isReconnecting.value = true
          reconnectAttempts.value++
          console.log(`Attempting to reconnect (${reconnectAttempts.value}/${maxReconnectAttempts})...`)
          setTimeout(connect, reconnectInterval)
        }
      }

      ws.value.onerror = (error) => {
        status.value = 'error'
        onError?.(error)
        console.error('WebSocket error:', error)
      }
    } catch (error) {
      status.value = 'error'
      console.error('Failed to create WebSocket:', error)
    }
  }

  const disconnect = () => {
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    status.value = 'disconnected'
    isReconnecting.value = false
  }

  const send = (data: any) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(data))
      return true
    }
    return false
  }

  // 自动连接
  onMounted(() => {
    connect()
  })

  // 自动断开
  onUnmounted(() => {
    disconnect()
  })

  return {
    status: readonly(status),
    connect,
    disconnect,
    send,
    reconnectAttempts: readonly(reconnectAttempts),
    isReconnecting: readonly(isReconnecting)
  }
}
