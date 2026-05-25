<script setup lang="ts">
import Layout from '@/layouts/Layout.vue'
import { SToast, SConfirm } from 'sbot-ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <Layout />
  <SToast />
  <SConfirm :default-confirm-text="t('common.confirm')" :default-cancel-text="t('common.cancel')" />
</template>
