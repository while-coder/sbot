<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { SButton, SFormItem, SFormSection, SInfoRow, SInfoTable, SSwitch, toast } from '@sbot/ui-kit'
import { backend } from '../../../lib/backend'
import { api } from '../../../lib/api'

const about = ref<{ name?: string; version?: string; description?: string }>({})
const autoCheckUpdate = ref(true)

onMounted(async () => {
  try {
    const [info, settings] = await Promise.all([
      api.get<{ name?: string; version?: string; description?: string }>('/api/about'),
      api.get<{ autoCheckUpdate?: boolean }>('/api/settings'),
    ])
    about.value = info
    autoCheckUpdate.value = settings.autoCheckUpdate ?? true
  } catch (e: any) {
    toast.show('error', e.message)
  }
})

/** 切换即存：接口按字段合并，只提交本字段 */
async function setAutoCheckUpdate(v: boolean): Promise<void> {
  const prev = autoCheckUpdate.value
  autoCheckUpdate.value = v
  try {
    await api.put('/api/settings/general', { autoCheckUpdate: v })
  } catch (e: any) {
    autoCheckUpdate.value = prev
    toast.show('error', e.message)
  }
}

function openAdmin(): void {
  if (!backend.baseUrl) { toast.show('error', 'sbot 服务尚未就绪'); return }
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

    <SFormSection title="更新">
      <SFormItem label="自动检查更新">
        <SSwitch :value="autoCheckUpdate" @update:value="setAutoCheckUpdate" />
      </SFormItem>
    </SFormSection>
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
