<script setup lang="ts">
import { computed } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { backend } from '../lib/backend'

// 销毁主窗口 → 应用退出（RunEvent::Exit）→ 后端回收
const exitApp = (): void => { void getCurrentWindow().destroy() }

const failed = computed(() => backend.phase === 'failed')
const hint = computed(() => backend.message || '正在启动…')
</script>

<template>
  <div class="splash">
    <div class="logo">SBot</div>

    <template v-if="!failed">
      <div class="spinner" aria-hidden="true"></div>
      <p class="message">{{ hint }}</p>
    </template>

    <template v-else>
      <p class="message failed">{{ hint }}</p>
      <pre v-if="backend.log" class="log">{{ backend.log }}</pre>
      <button class="exit-btn" type="button" @click="exitApp">退出</button>
    </template>
  </div>
</template>

<style scoped>
.splash {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  background: var(--chatui-bg, #fafafa);
  color: var(--chatui-fg-muted, #5f6368);
  font-size: 13px;
}
.logo {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--chatui-fg, #1f2328);
}
.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--chatui-border, #d0d3d8);
  border-top-color: var(--chatui-fg, #1f2328);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.message {
  margin: 0;
  max-width: 560px;
  text-align: center;
}
.message.failed {
  color: var(--chatui-danger, #d93025);
  white-space: pre-wrap;
}
.log {
  max-width: 720px;
  max-height: 40vh;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: var(--chatui-bg-hover, #f1f3f4);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
.exit-btn {
  margin-top: 4px;
  padding: 6px 20px;
  border: 1px solid var(--chatui-border, #d0d3d8);
  border-radius: 6px;
  background: transparent;
  color: var(--chatui-fg, #1f2328);
  font-size: 13px;
  cursor: pointer;
}
.exit-btn:hover {
  background: var(--chatui-bg-hover, #f1f3f4);
}
</style>
