<script setup lang="ts">
withDefaults(defineProps<{
  padded?: boolean
}>(), {
  padded: true,
})
</script>

<template>
  <div class="s-page-content" :class="{ 's-page-content--padded': padded }">
    <slot />
  </div>
</template>

<style scoped>
.s-page-content {
  overflow-y: auto;
  flex: 1;
  width: 100%;
  min-width: 0;
}
.s-page-content--padded {
  padding: var(--sui-sp-8);
}
</style>
