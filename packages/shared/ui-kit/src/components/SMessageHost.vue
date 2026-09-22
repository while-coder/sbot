<script setup lang="ts">
import { Teleport } from "vue"
import { confirmState, loadingItems, toastItems } from "../composables/message"
import SButton from "./button/SButton.vue"
import SModal from "./SModal.vue"

defineOptions({ name: "SFeedbackHost" })

//confirmText/cancelText 是未定制文案时的默认按钮文案（如宿主应用传 i18n 文案）
const props = defineProps<{ confirmText?: string; cancelText?: string }>()

const settle = (confirmed: boolean) => {
  const resolve = confirmState.resolve
  confirmState.visible = false
  confirmState.onOk = undefined
  confirmState.resolve = undefined
  resolve?.(confirmed)
}
const accept = async () => { const callback = confirmState.onOk; settle(true); await callback?.() }
</script>

<template>
  <Teleport to="body">
    <div class="s-toast-stack" aria-live="polite">
      <div v-for="item in toastItems" :key="item.id" :class="['s-toast', `type-${item.type}`]"
        :role="item.type === 'error' ? 'alert' : 'status'">{{ item.text }}</div>
    </div>
  </Teleport>
  <div class="s-progress-stack">
    <div v-for="item in loadingItems" :key="item.id" class="s-progress-hud" role="status">
      <span class="s-progress-hud-text">{{ item.text }}</span>
      <div v-if="item.ratio != null" class="s-progress-hud-bar">
        <div class="s-progress-hud-fill" :style="{ width: `${Math.max(2, Math.min(100, Math.round(item.ratio * 100)))}%` }" />
      </div>
    </div>
  </div>
  <SModal :show="confirmState.visible" :title="confirmState.title" nested
    @update:show="(value: boolean) => { if (!value) settle(false) }">
    <p class="s-confirm-content">{{ confirmState.content }}</p>
    <template #footer>
      <SButton @click="settle(false)">{{ confirmState.cancelText ?? props.cancelText ?? "取消" }}</SButton>
      <SButton :type="confirmState.danger ? 'error' : 'primary'" @click="accept">{{ confirmState.confirmText ?? props.confirmText ?? "确定" }}</SButton>
    </template>
  </SModal>
</template>

<style scoped>
.s-toast-stack { position: fixed; top: 16px; left: 50%; z-index: var(--sui-z-toast); display: flex; max-width: calc(100vw - 32px); flex-direction: column; align-items: center; gap: 8px; transform: translateX(-50%); pointer-events: none; }
.s-toast { box-sizing: border-box; width: fit-content; min-width: min(220px, calc(100vw - 32px)); max-width: min(520px, calc(100vw - 32px)); padding: 9px 12px; overflow-wrap: anywhere; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); color: var(--sui-fg); line-height: 1.5; white-space: pre-wrap; }
.s-toast.type-success { border-left: 3px solid var(--sui-success); }
.s-toast.type-warning { border-left: 3px solid var(--sui-warning); }
.s-toast.type-error { border-left: 3px solid var(--sui-danger); }
.s-toast.type-info { border-left: 3px solid var(--sui-info); }
.s-confirm-content { margin: 0; color: var(--sui-fg-secondary); line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; }
.s-progress-stack { position: fixed; bottom: 24px; left: 50%; z-index: var(--sui-z-toast); display: flex; flex-direction: column; align-items: center; gap: 8px; transform: translateX(-50%); pointer-events: none; }
.s-progress-hud { box-sizing: border-box; display: flex; min-width: min(260px, calc(100vw - 32px)); max-width: min(460px, calc(100vw - 32px)); flex-direction: column; gap: 6px; padding: 10px 14px; border: 1px solid var(--sui-border); border-radius: var(--sui-radius-md); background: var(--sui-bg); box-shadow: var(--sui-shadow-lg); color: var(--sui-fg); font-size: 12px; line-height: 1.5; }
.s-progress-hud-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-progress-hud-bar { overflow: hidden; height: 4px; border-radius: var(--sui-radius-full, 999px); background: color-mix(in srgb, var(--sui-fg) 12%, transparent); }
.s-progress-hud-fill { height: 100%; border-radius: inherit; background: var(--sui-info); transition: width .15s ease-out; }
</style>
