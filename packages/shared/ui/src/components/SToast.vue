<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { state } = useToast()
</script>

<template>
  <Teleport to="body">
    <div v-if="state.visible" class="s-toast" :class="{ 's-toast--error': state.type === 'error' }">
      {{ state.message }}
    </div>
  </Teleport>
</template>

<style scoped>
.s-toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: var(--sui-radius-lg);
  font-size: var(--sui-fs-md);
  font-weight: 500;
  background: var(--sui-fg);
  color: var(--sui-bg);
  z-index: var(--sui-z-toast);
  box-shadow: var(--sui-shadow-toast);
  pointer-events: none;
}
.s-toast--error {
  background: var(--sui-danger);
  color: #fff;
}
</style>
