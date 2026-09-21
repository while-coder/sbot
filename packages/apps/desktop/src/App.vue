<script setup lang="ts">
import { SConfirm, SToast } from '@sbot/ui'
import MainApp from './components/MainApp.vue'
import SettingsApp from './components/settings/SettingsApp.vue'

// 两窗口共用同一 bundle，按 URL hash 分流（窗口创建时即定型，无需响应式路由）
const isSettings = window.location.hash.startsWith('#/settings')
</script>

<template>
  <SettingsApp v-if="isSettings" />
  <MainApp v-else />
  <SToast />
  <SConfirm default-confirm-text="确定" default-cancel-text="取消" />
</template>
