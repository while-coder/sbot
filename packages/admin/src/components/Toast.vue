<script setup lang="ts">
import { useToast } from '@/composables/useToast'
const { state } = useToast()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.visible"
      class="toast"
      :class="state.type === 'error' ? 'error' : ''"
    >
      {{ state.message }}
    </div>
  </Teleport>
</template>
