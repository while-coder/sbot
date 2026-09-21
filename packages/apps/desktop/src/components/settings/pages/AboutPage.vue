<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { SButton, SInfoRow, SInfoTable, useToast } from '@sbot/ui'
import { backend } from '../../../lib/backend'
import { api } from '../../../lib/api'

const toast = useToast()
const about = ref<{ name?: string; version?: string; description?: string }>({})

onMounted(async () => {
  try {
    about.value = await api.get<{ name?: string; version?: string; description?: string }>('/api/about')
  } catch (e: any) {
    toast.error(e.message)
  }
})

function openAdmin(): void {
  if (!backend.baseUrl) { toast.error('sbot 服务尚未就绪'); return }
  void invoke('open_admin_ui')
}

function openLogs(): void {
  void invoke('open_log_dir')
}
</script>

<template>
  <div class="page">
    <SInfoTable>
      <SInfoRow label="应用">{{ about.name || 'SBot' }}</SInfoRow>
      <SInfoRow label="后端版本">{{ about.version || '-' }}</SInfoRow>
      <SInfoRow label="服务地址">{{ backend.baseUrl || '-' }}</SInfoRow>
      <SInfoRow label="后端进程">
        {{ backend.owned ? '由桌面端启动（退出时自动回收）' : '复用本机已运行的 sbot 服务' }}
      </SInfoRow>
    </SInfoTable>

    <p v-if="about.description" class="desc">{{ about.description }}</p>

    <div class="actions">
      <SButton type="outline" @click="openAdmin">打开 Admin Web UI</SButton>
      <SButton type="outline" @click="openLogs">打开日志目录</SButton>
    </div>
    <p class="hint">
      Agent 与 MCP 的高级配置可在 Admin Web UI 中管理。
    </p>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}
.desc {
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--sui-fg-muted, #8a8f98);
}
.actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
}
.hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--sui-fg-disabled, #b0b4ba);
}
</style>
