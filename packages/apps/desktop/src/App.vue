<script setup lang="ts">
import { SConfirm, SToast } from '@sbot/ui-kit'
import MainApp from './components/MainApp.vue'
</script>

<template>
  <MainApp />
  <SToast />
  <SConfirm default-confirm-text="确定" default-cancel-text="取消" />
</template>
