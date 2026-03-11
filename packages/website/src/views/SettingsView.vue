<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const { show } = useToast()

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
    show('保存成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div>
    <div v-if="portMismatch" class="port-mismatch-banner">
      端口已变更，修改将在重启服务后生效
    </div>
    <div class="page-toolbar">
      <button class="btn-primary btn-sm" @click="save">保存</button>
    </div>
    <div class="page-content">
      <div class="card">
        <div class="card-title">服务</div>
        <div class="inline-form">
          <div class="form-group">
            <label>HTTP 端口</label>
            <input v-model.number="httpPort" type="number" placeholder="5500" min="1" max="65535" />
          </div>
          <div class="form-group">
            <label>HTTP URL</label>
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
