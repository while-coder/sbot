<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  SButton, SInput, SSelect, SSwitch, STagInput, SFormItem, SFormSection,
} from '@sbot/ui'
import { api } from '../../../lib/api'
import { emitSettingsChanged } from '../../../lib/settingsEvents'
import { BUILTIN_AGENTS, BUILTIN_AGENT_MCPS } from '../../../lib/defaultAgent'
import { useToast } from '@sbot/ui'
import { themeMode } from '../../../theme/theme'
import type { ThemeMode } from '../../../theme/theme'

interface GeneralSettings {
  httpPort?: number
  httpUrl?: string
  autoApproveTools?: string[]
  autoApproveAllTools?: boolean
  startupCommands?: string[]
  autoCheckUpdate?: boolean
  maxImageSize?: number
  contextFileNames?: string[]
  models?: Record<string, { name?: string }>
}

const toast = useToast()
const loaded = ref(false)
const saving = ref(false)

// ── 内置助手 ──

const models = ref<Record<string, { name?: string }>>({})
const builtinModels = ref<Record<string, string>>({})

const modelOptions = computed(() =>
  Object.entries(models.value).map(([id, m]) => ({ value: id, label: m.name || id })),
)

const form = ref<Required<Pick<GeneralSettings, 'autoApproveAllTools' | 'autoCheckUpdate'>> & GeneralSettings>({
  httpUrl: '',
  autoApproveTools: [],
  autoApproveAllTools: false,
  startupCommands: [],
  autoCheckUpdate: true,
  maxImageSize: undefined,
  contextFileNames: [],
})

onMounted(async () => {
  try {
    const settings = await api.get<GeneralSettings>('/api/settings')
    form.value = {
      httpPort: settings.httpPort,
      httpUrl: settings.httpUrl ?? '',
      autoApproveTools: settings.autoApproveTools ?? [],
      autoApproveAllTools: settings.autoApproveAllTools ?? false,
      startupCommands: settings.startupCommands ?? [],
      autoCheckUpdate: settings.autoCheckUpdate ?? true,
      maxImageSize: settings.maxImageSize,
      contextFileNames: settings.contextFileNames ?? [],
    }
    models.value = settings.models ?? {}
    try {
      const agents = await api.get<Array<{ id: string; model?: string }>>('/api/agents')
      const modelById = Object.fromEntries(agents?.map(a => [a.id, a.model ?? '']) ?? [])
      builtinModels.value = Object.fromEntries(
        BUILTIN_AGENTS.map(def => [def.id, modelById[def.id] ?? '']),
      )
    } catch {
      // 内置助手尚未创建（如无模型），下拉留空即可
    }
    loaded.value = true
  } catch (e: any) {
    toast.error(e.message)
  }
})

async function save(): Promise<void> {
  saving.value = true
  try {
    await api.put('/api/settings/general', {
      httpUrl: form.value.httpUrl,
      autoApproveTools: form.value.autoApproveTools,
      autoApproveAllTools: form.value.autoApproveAllTools,
      startupCommands: form.value.startupCommands,
      autoCheckUpdate: form.value.autoCheckUpdate,
      maxImageSize: form.value.maxImageSize,
      contextFileNames: form.value.contextFileNames,
    })
    await saveBuiltinAgents()
    toast.success('已保存')
    emitSettingsChanged()
  } catch (e: any) {
    toast.error(e.message)
  } finally {
    saving.value = false
  }
}

/** 保存各内置助手的模型（saveAgent 为整体替换，需取最新条目全字段带回；缺失的当场创建） */
async function saveBuiltinAgents(): Promise<void> {
  const changed = BUILTIN_AGENTS.filter(def => builtinModels.value[def.id])
  if (!changed.length) return
  const agents = await api.get<Array<Record<string, unknown> & { id: string }>>('/api/agents')
  for (const def of changed) {
    const model = builtinModels.value[def.id]
    const entry = agents?.find(a => a.id === def.id)
    if (entry) {
      await api.put(`/api/agents/${def.id}`, {
        ...entry,
        name: def.name,
        model,
        mcp: BUILTIN_AGENT_MCPS,
        systemPrompt: def.prompt,
      })
    } else {
      await api.post('/api/agents', {
        id: def.id,
        name: def.name,
        type: 'single',
        model,
        mcp: BUILTIN_AGENT_MCPS,
        systemPrompt: def.prompt,
      })
    }
  }
}

const themeOptions = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
]

const themeModeValue = computed<ThemeMode>({
  get: () => themeMode.value,
  set: (v) => { themeMode.value = v },
})
</script>

<template>
  <div class="page">
    <SFormSection title="外观">
      <SFormItem label="主题">
        <SSelect v-model="themeModeValue" :options="themeOptions" class="narrow" />
        <template #hint>更改立即生效，并在主窗口同步</template>
      </SFormItem>
    </SFormSection>

    <SFormSection title="内置助手">
      <SFormItem v-for="def in BUILTIN_AGENTS" :key="def.id" :label="def.name">
        <SSelect
          v-model="builtinModels[def.id]"
          :options="modelOptions"
          class="narrow"
          :disabled="!modelOptions.length"
        />
        <template #hint>{{ modelOptions.length ? '聊天窗口使用的固定助手，此处为其执行模型' : '请先在「模型」页添加模型' }}</template>
      </SFormItem>
    </SFormSection>

    <SFormSection title="通用">
      <SFormItem label="自动检查更新">
        <SSwitch v-model="form.autoCheckUpdate" />
      </SFormItem>
      <SFormItem label="外网访问 URL">
        <SInput v-model="form.httpUrl" placeholder="https://example.com（留空禁用）" />
        <template #hint>对外展示的服务地址，用于生成回调链接</template>
      </SFormItem>
      <SFormItem label="图片最大尺寸 (px)">
        <SInput v-model.number="form.maxImageSize" type="number" placeholder="不设置则不压缩" class="narrow" />
      </SFormItem>
      <SFormItem label="上下文文件名">
        <STagInput v-model="form.contextFileNames" placeholder="回车添加，如 SBOT.md" />
        <template #hint>工作目录上下文文件按优先级排列，留空使用默认</template>
      </SFormItem>
    </SFormSection>

    <SFormSection title="工具审批">
      <SFormItem label="自动审批全部工具">
        <SSwitch v-model="form.autoApproveAllTools" />
      </SFormItem>
      <SFormItem label="自动审批工具列表">
        <STagInput v-model="form.autoApproveTools" placeholder="回车添加工具名" />
        <template #hint>命中列表的工具执行时不再请求确认</template>
      </SFormItem>
    </SFormSection>

    <SFormSection title="高级">
      <SFormItem label="启动命令">
        <STagInput v-model="form.startupCommands" placeholder="回车添加命令行，启动后依次执行" />
      </SFormItem>
      <SFormItem label="HTTP 端口">
        <SInput :model-value="form.httpPort ?? '自动分配'" disabled class="narrow" />
        <template #hint>桌面端端口由启动器自动管理，此处的端口仅对 CLI 运行方式生效</template>
      </SFormItem>
    </SFormSection>

    <div class="footer">
      <SButton type="primary" :disabled="!loaded" :loading="saving" @click="save">保存</SButton>
    </div>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}
.narrow {
  max-width: 280px;
}
.footer {
  padding: 12px 0 24px;
}
</style>
