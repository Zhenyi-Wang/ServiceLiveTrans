<script setup lang="ts">
import type { NotificationItem, NotificationType } from '~/composables/useNotification'

interface Props {
  notification: NotificationItem
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
}>()

const typeStyles: Record<NotificationType, { border: string; icon: string; color: string }> = {
  success: {
    border: 'border-l-green-500',
    icon: 'i-heroicons-check-circle',
    color: 'text-green-500'
  },
  error: {
    border: 'border-l-red-500',
    icon: 'i-heroicons-x-circle',
    color: 'text-red-500'
  },
  warning: {
    border: 'border-l-yellow-500',
    icon: 'i-heroicons-exclamation-triangle',
    color: 'text-yellow-500'
  },
  info: {
    border: 'border-l-blue-500',
    icon: 'i-heroicons-information-circle',
    color: 'text-blue-500'
  }
}

const currentStyle = computed(() => typeStyles[props.notification.type])
</script>

<template>
  <Transition name="notification">
    <div
      v-if="notification.visible"
      class="notification"
      :class="currentStyle.border"
    >
      <div class="notification-icon" :class="currentStyle.color">
        <UIcon :name="currentStyle.icon" class="w-5 h-5" />
      </div>
      <div class="notification-content">
        {{ notification.message }}
      </div>
      <button
        class="notification-close"
        @click="emit('close')"
      >
        <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.notification {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-left: 4px solid;
  min-width: 280px;
  max-width: 400px;
}

.notification-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notification-content {
  flex: 1;
  font-size: 0.9rem;
  color: var(--text-color);
  line-height: 1.4;
}

.notification-close {
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notification-close:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

/* 动画 */
.notification-enter-active,
.notification-leave-active {
  transition: all 0.3s ease;
}

.notification-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.notification-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

/* 深色主题 */
:global(.dark) .notification {
  background: var(--bg-secondary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
</style>
