<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { sourceBadgeStyle } from '@/utils/badges'

const props = defineProps<{
  visible: boolean
  title: string
  badge: string
  content: string
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const { t } = useI18n()

const parsed = computed(() => {
  const raw = props.content
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { description: '', body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (m) meta[m[1]] = m[2]
  }
  return { description: meta.description || '', body: match[2].trim() }
})

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-box wide">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span v-if="badge" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(badge)}`">{{ badge }}</span>
          <h3 style="margin:0;font-family:monospace">{{ title }}</h3>
        </div>
        <button class="modal-close" @click="close">&times;</button>
      </div>
      <div class="modal-body">
        <div v-if="loading" style="text-align:center;color:#94a3b8;padding:40px">{{ t('common.loading') }}</div>
        <template v-else>
          <div v-if="parsed.description" style="margin-bottom:12px;font-size:13px;color:#475569">{{ parsed.description }}</div>
          <pre style="margin:0;padding:14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;overflow:auto;max-height:460px;white-space:pre-wrap;word-break:break-word;color:#1e293b">{{ parsed.body || content }}</pre>
        </template>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="close">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>
