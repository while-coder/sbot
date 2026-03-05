<script setup lang="ts">
import { ref, watch } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const { show } = useToast()

const httpUrl = ref('')
const larkAppId = ref('')
const larkAppSecret = ref('')

watch(() => store.settings, (s) => {
  httpUrl.value = s.httpUrl || ''
  larkAppId.value = s.lark?.appId || ''
  larkAppSecret.value = s.lark?.appSecret || ''
}, { immediate: true, deep: true })

async function save() {
  try {
    store.settings.httpUrl = httpUrl.value.trim() || undefined
    if (!store.settings.lark) store.settings.lark = {}
    store.settings.lark.appId = larkAppId.value
    store.settings.lark.appSecret = larkAppSecret.value
    await apiFetch('/api/settings', 'PUT', store.settings)
    show('保存成功')
  } catch (e: any) {
    show(e.message, 'error')
  }
}
</script>

<template>
  <div>
    <div class="page-toolbar">
      <button class="btn-primary btn-sm" @click="save">保存</button>
    </div>
    <div class="page-content">
      <div class="card">
        <div class="card-title">服务</div>
        <div class="inline-form">
          <div class="form-group">
            <label>HTTP URL</label>
            <input v-model="httpUrl" type="text" placeholder="http://localhost:5500" />
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Lark 应用</div>
        <div class="inline-form">
          <div class="form-group">
            <label>App ID</label>
            <input v-model="larkAppId" type="text" placeholder="cli_xxx" />
          </div>
          <div class="form-group">
            <label>App Secret</label>
            <input v-model="larkAppSecret" type="password" placeholder="secret" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
