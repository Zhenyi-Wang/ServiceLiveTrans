<script setup lang="ts">
import type { ConnectionStatus } from '~/composables/useWebSocket'

interface Props {
  status: ConnectionStatus
}

const props = defineProps<Props>()

const statusConfig = computed(() => {
  switch (props.status) {
    case 'connected':
      return {
        color: 'var(--primary-color)',
        bgColor: 'rgba(var(--primary-rgb), 0.1)',
        label: '已连接',
        connected: true
      }
    case 'connecting':
      return {
        color: '#eab308',
        bgColor: 'rgba(234, 179, 8, 0.1)',
        label: '连接中...',
        connected: false
      }
    case 'error':
      return {
        color: '#ef4444',
        bgColor: 'rgba(239, 68, 68, 0.1)',
        label: '连接错误',
        connected: false
      }
    default:
      return {
        color: '#9ca3af',
        bgColor: 'rgba(156, 163, 175, 0.1)',
        label: '未连接',
        connected: false
      }
  }
})
</script>

<template>
  <div class="connection-status">
    <div
      class="connection-dot"
      :class="{ connected: statusConfig.connected }"
      :style="{ backgroundColor: statusConfig.color }"
    />
    <span class="connection-label">{{ statusConfig.label }}</span>
  </div>
</template>

<style scoped>
.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 16px;
  background: v-bind('statusConfig.bgColor');
}

.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: all 0.3s ease;
}

.connection-dot.connected {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(var(--primary-rgb), 0);
  }
}

.connection-label {
  font-size: 0.85rem;
  color: v-bind('statusConfig.color');
  font-weight: 500;
}

/* 深色主题 */
:global(.dark) .connection-status {
  background: rgba(255, 255, 255, 0.05);
}
</style>
