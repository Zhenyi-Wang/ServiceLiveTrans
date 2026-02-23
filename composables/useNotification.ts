/**
 * 通知系统 composable
 * 管理应用通知的显示和隐藏
 */

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface NotificationItem {
  id: string
  type: NotificationType
  message: string
  duration: number
  visible: boolean
}

// 全局通知状态
const notifications = ref<NotificationItem[]>([])

// 生成唯一 ID
const generateId = () => `notification-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export function useNotification() {
  // 显示通知
  const show = (
    message: string,
    type: NotificationType = 'info',
    duration: number = 3000
  ) => {
    const id = generateId()
    const notification: NotificationItem = {
      id,
      type,
      message,
      duration,
      visible: true
    }

    notifications.value.push(notification)

    // 自动隐藏
    if (duration > 0) {
      setTimeout(() => {
        hide(id)
      }, duration)
    }

    return id
  }

  // 隐藏通知
  const hide = (id: string) => {
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value[index].visible = false
      // 延迟移除，等待动画完成
      setTimeout(() => {
        const removeIndex = notifications.value.findIndex(n => n.id === id)
        if (removeIndex !== -1) {
          notifications.value.splice(removeIndex, 1)
        }
      }, 300)
    }
  }

  // 清除所有通知
  const clearAll = () => {
    notifications.value = []
  }

  // 便捷方法
  const success = (message: string, duration?: number) => show(message, 'success', duration)
  const error = (message: string, duration?: number) => show(message, 'error', duration)
  const warning = (message: string, duration?: number) => show(message, 'warning', duration)
  const info = (message: string, duration?: number) => show(message, 'info', duration)

  return {
    notifications: readonly(notifications),
    show,
    hide,
    clearAll,
    success,
    error,
    warning,
    info
  }
}
