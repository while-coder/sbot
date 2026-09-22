<script setup lang="ts">
import { SMessageHost } from '@sbot/ui-kit'
import MainApp from './components/MainApp.vue'
</script>

<template>
  <MainApp />
  <SMessageHost confirm-text="确定" cancel-text="取消" />
</template>
