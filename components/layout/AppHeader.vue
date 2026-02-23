<script setup lang="ts">
import type { ConnectionStatus } from '~/composables/useWebSocket'

interface Props {
  wsConnected: boolean
  showMenu: boolean
  isDark: boolean
  connectionStatus: ConnectionStatus
}

defineProps<Props>()

defineEmits<{
  toggleMenu: []
  toggleDark: []
}>()
</script>

<template>
  <header class="header">
    <div class="header-content">
      <div class="header-left">
        <CommonConnectionStatus :status="connectionStatus" />
        <h2 class="header-title">Live Translation | 实时翻译</h2>
      </div>
      <div class="header-right">
        <button
          v-show="!showMenu"
          class="menu-btn"
          aria-label="打开设置"
          @click="$emit('toggleMenu')"
        >
          <UIcon name="i-heroicons-cog-6-tooth" class="w-5 h-5" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  flex-shrink: 0;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  min-height: 40px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-color);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-btn {
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: var(--text-color);
  padding: 6px;
  border-radius: 6px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  opacity: 0.7;
}

.menu-btn:hover {
  background-color: var(--hover-bg);
  transform: scale(1.1);
  opacity: 1;
}

.menu-btn:active {
  transform: scale(0.95);
}

/* 深色主题 */
:global(.dark) .header-content {
  background-color: #1a1a1a;
  border-bottom-color: #333;
}

:global(.dark) .header-title {
  color: #e0e0e0;
}

:global(.dark) .menu-btn {
  color: #cccccc;
}

:global(.dark) .menu-btn:hover {
  background-color: #404040;
}

/* 响应式 */
@media (max-width: 768px) {
  .header-content {
    padding: 0 15px;
    min-height: 36px;
  }

  .header-title {
    font-size: 0.9rem;
  }

  .menu-btn {
    min-width: 28px;
    min-height: 28px;
    padding: 4px;
  }
}
</style>
