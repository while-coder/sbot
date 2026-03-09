<script setup lang="ts">
import { ref, watch } from 'vue'
import { apiFetch } from '@/api'
import { store } from '@/store'
import { useToast } from '@/composables/useToast'

const { show } = useToast()

const httpUrl = ref('')

watch(() => store.settings, (s) => {
  httpUrl.value = s.httpUrl || ''
}, { immediate: true, deep: true })

async function save() {
  try {
    const res = await apiFetch('/api/settings/general', 'PUT', {
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
    </div>
  </div>
</template>
