<script setup lang="ts">
interface Props {
  hidden?: boolean
}

defineProps<Props>()
</script>

<template>
  <div
    class="divider"
    :class="{ hidden }"
  />
</template>

<style scoped>
.divider {
  height: 2px;
  background: linear-gradient(90deg, #00adb5, #f38181);
  margin: 0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
  transition: opacity 0.3s ease;
}

.divider.hidden {
  opacity: 0;
  pointer-events: none;
}
</style>
