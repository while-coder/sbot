<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import FeatureLoopsPanel from '@sbot/chat-ui/components/FeatureLoopsPanel.vue'

const { locale } = useI18n()
</script>

<template>
  <FeatureLoopsPanel :locale="locale" />
</template>
