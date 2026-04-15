<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { useToast } from '@/composables/useToast'
import { sourceBadgeStyle } from '@/utils/badges'

const { t } = useI18n()
const { show } = useToast()

const visible = ref(false)
const viewName = ref('')
const viewBadge = ref('')
const viewContent = ref('')
const viewLoading = ref(false)

const viewParsed = computed(() => {
  const content = viewContent.value
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { description: '', body: content }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (m) meta[m[1]] = m[2]
  }
  return { description: meta.description || '', body: match[2].trim() }
})

async function open(name: string, badge: string, fetchUrl: string) {
  viewName.value = name
  viewBadge.value = badge
  viewContent.value = ''
  viewLoading.value = true
  visible.value = true
  try {
    const res = await apiFetch(fetchUrl)
    viewContent.value = res.data?.content || ''
  } catch (e: any) {
    show(e.message, 'error')
    visible.value = false
  } finally {
    viewLoading.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="visible = false">
    <div class="modal-box wide">
      <div class="modal-header">
        <h3>{{ t('common.view') }} Skill</h3>
        <button class="modal-close" @click="visible = false">&times;</button>
      </div>
      <div class="modal-body">
        <div v-if="viewLoading" style="text-align:center;color:#94a3b8;padding:40px">{{ t('common.loading') }}</div>
        <template v-else>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span v-if="viewBadge" :style="`font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;${sourceBadgeStyle(viewBadge)}`">{{ viewBadge }}</span>
            <span style="font-family:monospace;font-size:15px;font-weight:600;color:#1e293b">{{ viewName }}</span>
          </div>
          <div v-if="viewParsed.description" style="margin-bottom:12px;font-size:13px;color:#475569">{{ viewParsed.description }}</div>
          <pre style="margin:0;padding:14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.6;overflow:auto;max-height:460px;white-space:pre-wrap;word-break:break-word;color:#1e293b">{{ viewParsed.body }}</pre>
        </template>
      </div>
      <div class="modal-footer">
        <button class="btn-outline" @click="visible = false">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>
