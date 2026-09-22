<script setup lang="ts">
import Layout from '@/layouts/Layout.vue'
import { SMessageHost } from '@sbot/ui-kit'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <Layout />
  <SMessageHost :confirm-text="t('common.confirm')" :cancel-text="t('common.cancel')" />
</template>
