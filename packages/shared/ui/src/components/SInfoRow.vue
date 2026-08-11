<script setup lang="ts">
defineProps<{
  label?: string
  mono?: boolean
}>()
</script>

<template>
  <tr class="s-info-row">
    <td class="s-info-row__label">
      <slot name="label">{{ label }}</slot>
    </td>
    <td class="s-info-row__value" :class="{ mono }">
      <slot />
    </td>
  </tr>
</template>
