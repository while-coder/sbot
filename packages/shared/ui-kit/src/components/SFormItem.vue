<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  hint?: string
  error?: string
  required?: boolean
  inline?: boolean
}>(), {})
</script>

<template>
  <div class="s-form-item" :class="{ 's-form-item--inline': inline }">
    <label v-if="label || $slots.label" class="s-form-item__label">
      <slot name="label">{{ label }}</slot>
      <span v-if="required" class="s-form-item__req">*</span>
    </label>
    <div class="s-form-item__control">
      <slot />
      <div v-if="error" class="s-form-item__error">{{ error }}</div>
      <div v-else-if="hint || $slots.hint" class="s-form-item__hint">
        <slot name="hint">{{ hint }}</slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.s-form-item {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-1);
  margin-bottom: var(--sui-sp-5);
}
.s-form-item--inline {
  flex: 1;
  min-width: 200px;
}
.s-form-item__label {
  font-size: var(--sui-fs-md);
  font-weight: 500;
  color: var(--sui-fg-secondary);
}
.s-form-item__req {
  color: var(--sui-danger);
  margin-left: 2px;
}
.s-form-item__control {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.s-form-item__hint {
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-disabled);
  margin-top: 2px;
}
.s-form-item__error {
  font-size: var(--sui-fs-xs);
  color: var(--sui-danger);
  margin-top: 2px;
}
</style>
