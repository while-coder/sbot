<script setup lang="ts">
import { useConfirm } from '../composables/useConfirm'
import SModal from './SModal.vue'
import SButton from './SButton.vue'

withDefaults(defineProps<{
  defaultConfirmText?: string
  defaultCancelText?: string
}>(), {
  defaultConfirmText: 'OK',
  defaultCancelText: 'Cancel',
})

const { state, _accept, _cancel } = useConfirm()
</script>

<template>
  <SModal
    :visible="state.visible"
    :title="state.title"
    width="sm"
    nested
    :close-on-overlay="false"
    @close="_cancel"
  >
    <div class="s-confirm-message">{{ state.message }}</div>
    <template #footer>
      <SButton type="outline" @click="_cancel">
        {{ state.cancelText || defaultCancelText }}
      </SButton>
      <SButton :type="state.danger ? 'danger' : 'primary'" @click="_accept">
        {{ state.confirmText || defaultConfirmText }}
      </SButton>
    </template>
  </SModal>
</template>

<style scoped>
.s-confirm-message {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--sui-fg);
  font-size: var(--sui-fs-md);
  line-height: 1.6;
}
</style>
