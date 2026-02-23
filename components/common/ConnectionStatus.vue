<script setup lang="ts">
import type { ConnectionStatus } from '~/composables/useWebSocket'

interface Props {
  status: ConnectionStatus
}

const props = defineProps<Props>()

const statusConfig = computed(() => {
  switch (props.status) {
    case 'connected':
      return { color: 'green', label: '已连接', icon: 'i-heroicons-signal' }
    case 'connecting':
      return { color: 'yellow', label: '连接中...', icon: 'i-heroicons-arrow-path' }
    case 'error':
      return { color: 'red', label: '连接错误', icon: 'i-heroicons-exclamation-triangle' }
    default:
      return { color: 'gray', label: '未连接', icon: 'i-heroicons-signal-slash' }
  }
})
</script>

<template>
  <div class="flex items-center gap-2">
    <UChip
      :color="statusConfig.color"
      size="md"
      inset
    >
      <template #default>
        <div class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800">
          <UIcon :name="statusConfig.icon" class="w-4 h-4" />
          <span class="text-sm">{{ statusConfig.label }}</span>
        </div>
      </template>
    </UChip>
  </div>
</template>
