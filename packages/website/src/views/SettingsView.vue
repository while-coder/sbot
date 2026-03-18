<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'
import { i18n, saveLocale } from '@/i18n'

const { t } = useI18n()

const { show } = useToast()

// ── Language ──────────────────────────────────────────────────────
const locale = ref(i18n.global.locale.value)
function changeLocale(lang: string) {
  locale.value = lang
  ;(i18n.global.locale as any).value = lang
  saveLocale(lang)
}

const httpPort = ref<number | ''>('')
const httpUrl = ref('')

watch(() => store.settings, (s) => {
  httpPort.value = s.httpPort ?? ''
  httpUrl.value = s.httpUrl || ''
}, { immediate: true, deep: true })

// 当前浏览器访问端口
const currentPort = parseInt(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80)

// 配置端口与当前访问端口不一致时显示提醒
const portMismatch = computed(() => {
  const p = httpPort.value === '' ? 5500 : Number(httpPort.value)
  return p !== currentPort
})

async function save() {
  try {
    const res = await apiFetch('/api/settings/general', 'PUT', {
      httpPort: httpPort.value === '' ? undefined : Number(httpPort.value),
      httpUrl: httpUrl.value.trim() || undefined,
    })
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div>
    <div v-if="portMismatch" class="port-mismatch-banner">
      {{ t('settings.port_changed') }}
    </div>
    <div class="page-toolbar">
      <button class="btn-primary btn-sm" @click="save">{{ t('common.save') }}</button>
    </div>
    <div class="page-content">
      <div class="card">
        <div class="card-title">{{ t('settings.language') }}</div>
        <div class="inline-form">
          <div class="form-group">
            <label>{{ t('settings.language') }}</label>
            <select :value="locale" @change="changeLocale(($event.target as HTMLSelectElement).value)">
              <option value="zh">{{ t('settings.lang_zh') }}</option>
              <option value="en">{{ t('settings.lang_en') }}</option>
            </select>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">{{ t('settings.service') }}</div>
        <div class="inline-form">
          <div class="form-group">
            <label>{{ t('settings.http_port') }}</label>
            <input v-model.number="httpPort" type="number" placeholder="5500" min="1" max="65535" />
          </div>
          <div class="form-group">
            <label>{{ t('settings.http_url') }}</label>
            <input v-model="httpUrl" type="text" placeholder="http://localhost:5500" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.port-mismatch-banner {
  background: var(--color-warning-bg, #7c5a0020);
  border-bottom: 1px solid var(--color-warning, #a07020);
  color: var(--color-warning, #c08020);
  font-size: 0.85rem;
  padding: 8px 16px;
  text-align: center;
}
</style>
