<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store } from '@/shared/store'
import { useToast, useConfirm, SButton, SInput, STextarea, SCard, SFormItem, SCheckCard, SPageToolbar, SPageContent } from 'sbot-ui'
const { t } = useI18n()

const { show } = useToast()
const { confirm } = useConfirm()

const httpPort = ref<number | ''>('')
const httpUrl = ref('')
const maxImageSize = ref<number | ''>('')
const autoApproveAllTools = ref(false)
const autoApproveToolsText = ref('')
const startupCommands = ref<string[]>([])
const contextFileNames = ref<string[]>([])

watch(() => store.settings, (s) => {
  httpPort.value = s.httpPort ?? ''
  httpUrl.value = s.httpUrl || ''
  maxImageSize.value = s.maxImageSize ?? ''
  autoApproveAllTools.value = s.autoApproveAllTools ?? false
  autoApproveToolsText.value = (s.autoApproveTools ?? []).join(', ')
  startupCommands.value = [...(s.startupCommands ?? [])]
  contextFileNames.value = [...(s.contextFileNames ?? [])]
}, { immediate: true, deep: true })

function addStartupCommand() {
  startupCommands.value.push('')
}
function removeStartupCommand(index: number) {
  startupCommands.value.splice(index, 1)
}
function addContextFileName() {
  contextFileNames.value.push('')
}
function removeContextFileName(index: number) {
  contextFileNames.value.splice(index, 1)
}

// ── Drag & Drop ──────────────────────────────────────────────────
// 每个可拖拽列表用独立 state，避免 startup / context 之间互相干扰
type DragState = { dragIndex: number | null; dropIndex: number | null }
const startupDrag = ref<DragState>({ dragIndex: null, dropIndex: null })
const contextDrag = ref<DragState>({ dragIndex: null, dropIndex: null })

function onDragStart(state: DragState, index: number, e: DragEvent) {
  state.dragIndex = index
  e.dataTransfer!.effectAllowed = 'move'
}
function onDragOver(state: DragState, index: number, e: DragEvent) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  state.dropIndex = index
}
function onDragLeave(state: DragState) {
  state.dropIndex = null
}
function onDrop(state: DragState, list: { value: string[] }, index: number) {
  const from = state.dragIndex
  if (from !== null && from !== index) {
    const item = list.value.splice(from, 1)[0]
    list.value.splice(index, 0, item)
  }
  state.dragIndex = null
  state.dropIndex = null
}
function onDragEnd(state: DragState) {
  state.dragIndex = null
  state.dropIndex = null
}

const currentPort = parseInt(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80)

const portMismatch = computed(() => {
  const p = httpPort.value === '' ? 5500 : Number(httpPort.value)
  return p !== currentPort
})

async function save() {
  try {
    const tools = autoApproveToolsText.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const cmds = startupCommands.value.filter(s => s.trim())
    const ctxNames = contextFileNames.value.map(s => s.trim()).filter(Boolean)
    const res = await apiFetch('/api/settings/general', 'PUT', {
      httpPort: httpPort.value === '' ? undefined : Number(httpPort.value),
      httpUrl: httpUrl.value.trim() || undefined,
      maxImageSize: maxImageSize.value === '' ? undefined : Number(maxImageSize.value),
      autoApproveAllTools: autoApproveAllTools.value,
      autoApproveTools: tools,
      startupCommands: cmds,
      contextFileNames: ctxNames,
    })
    Object.assign(store.settings, res.data)
    show(t('common.saved'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}

// ── Scan invalid data ───────────────────────────────────────────

interface InvalidRef { source: string; field: string; badValue: string }

interface CleanupReport {
  dryRun: boolean
  // 跨表残留行（自动清）
  orphanChannelSessions: Array<{ id: number; channelId: string; sessionId: string; sessionName: string }>
  orphanChannelUsers: Array<{ id: number; channelId: string; userId: string; userName: string }>
  orphanAutoProfiles: Array<{ id: number; autoForSessionId: number; name: string }>
  orphanHeartbeats: Array<{ id: number; target: number; name: string }>
  // 仅列出
  emptyVisibleProfiles: Array<{ id: number; name: string }>
  // 引用了不存在目标（仅列出，需用户手改）
  invalidAgentRefs: InvalidRef[]
  invalidSaverRefs: InvalidRef[]
  invalidModelRefs: InvalidRef[]
  invalidEmbeddingRefs: InvalidRef[]
  invalidNoteRefs: InvalidRef[]
  invalidWikiRefs: InvalidRef[]
  invalidInsightProfileRefs: InvalidRef[]
  invalidAgendaProfileRefs: InvalidRef[]
}

const cleanupReport = ref<CleanupReport | null>(null)
const cleanupLoading = ref(false)
const cleanupExpand = ref<Record<string, boolean>>({})

const cleanupCategories = computed<Array<{ key: keyof CleanupReport; label: string; cleaned: boolean; items: any[] }>>(() => {
  const r = cleanupReport.value
  if (!r) return []
  return [
    // 自动清理：跨表残留行
    { key: 'orphanChannelSessions', label: t('settings.cleanup_orphan_sessions'),  cleaned: true,  items: r.orphanChannelSessions },
    { key: 'orphanChannelUsers',    label: t('settings.cleanup_orphan_users'),     cleaned: true,  items: r.orphanChannelUsers },
    { key: 'orphanAutoProfiles',    label: t('settings.cleanup_orphan_auto_profiles'), cleaned: true, items: r.orphanAutoProfiles },
    { key: 'orphanHeartbeats',      label: t('settings.cleanup_orphan_heartbeats'), cleaned: true,  items: r.orphanHeartbeats },
    // 仅列出
    { key: 'emptyVisibleProfiles',  label: t('settings.cleanup_empty_profiles'),   cleaned: false, items: r.emptyVisibleProfiles },
    // 无效引用（仅列出，需手改）
    { key: 'invalidAgentRefs',          label: t('settings.invalid_agent_refs'),          cleaned: false, items: r.invalidAgentRefs },
    { key: 'invalidSaverRefs',          label: t('settings.invalid_saver_refs'),          cleaned: false, items: r.invalidSaverRefs },
    { key: 'invalidModelRefs',          label: t('settings.invalid_model_refs'),          cleaned: false, items: r.invalidModelRefs },
    { key: 'invalidEmbeddingRefs',      label: t('settings.invalid_embedding_refs'),      cleaned: false, items: r.invalidEmbeddingRefs },
    { key: 'invalidNoteRefs',           label: t('settings.invalid_note_refs'),           cleaned: false, items: r.invalidNoteRefs },
    { key: 'invalidWikiRefs',           label: t('settings.invalid_wiki_refs'),           cleaned: false, items: r.invalidWikiRefs },
    { key: 'invalidInsightProfileRefs', label: t('settings.invalid_insight_profile_refs'),cleaned: false, items: r.invalidInsightProfileRefs },
    { key: 'invalidAgendaProfileRefs',  label: t('settings.invalid_agenda_profile_refs'), cleaned: false, items: r.invalidAgendaProfileRefs },
  ]
})

const issuesCount = computed(() =>
  cleanupCategories.value.reduce((sum, c) => sum + c.items.length, 0)
)

const cleanableCount = computed(() =>
  cleanupCategories.value
    .filter(c => c.cleaned)
    .reduce((sum, c) => sum + c.items.length, 0)
)

async function scanCleanup() {
  cleanupLoading.value = true
  try {
    const res = await apiFetch('/api/admin/cleanup-orphans', 'POST', {})
    cleanupReport.value = res.data as CleanupReport
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    cleanupLoading.value = false
  }
}

async function applyCleanup() {
  if (cleanableCount.value === 0) return
  if (!await confirm(t('settings.cleanup_confirm', { n: cleanableCount.value }), { danger: true })) return
  cleanupLoading.value = true
  try {
    const res = await apiFetch('/api/admin/cleanup-orphans?apply=1', 'POST', {})
    cleanupReport.value = res.data as CleanupReport
    show(t('settings.cleanup_done'))
  } catch (e: any) {
    show(e.message, 'error')
  } finally {
    cleanupLoading.value = false
  }
}

function fmtItem(category: string, item: any): string {
  switch (category) {
    case 'orphanChannelSessions':
      return `#${item.id} channel="${item.channelId}" sessionId="${item.sessionId}" name="${item.sessionName || ''}"`
    case 'orphanChannelUsers':
      return `#${item.id} channel="${item.channelId}" user="${item.userId}" name="${item.userName || ''}"`
    case 'orphanAutoProfiles':
      return `#${item.id} autoForSessionId=${item.autoForSessionId} name="${item.name || ''}"`
    case 'orphanHeartbeats':
      return `#${item.id} target=${item.target} name="${item.name || ''}"`
    case 'emptyVisibleProfiles':
      return `#${item.id} name="${item.name || ''}"`
    case 'invalidAgentRefs':
    case 'invalidSaverRefs':
    case 'invalidModelRefs':
    case 'invalidEmbeddingRefs':
    case 'invalidNoteRefs':
    case 'invalidWikiRefs':
    case 'invalidInsightProfileRefs':
    case 'invalidAgendaProfileRefs':
      return `${item.source} → ${item.field} = "${item.badValue}"`
  }
  return JSON.stringify(item)
}
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div v-if="portMismatch" class="port-mismatch-banner">
      {{ t('settings.port_changed') }}
    </div>
    <SPageToolbar>
      <SButton type="primary" size="sm" @click="save">{{ t('common.save') }}</SButton>
    </SPageToolbar>
    <SPageContent>
      <SCard :title="t('settings.service')">
        <div class="inline-form">
          <SFormItem :label="t('settings.http_port')">
            <SInput v-model.number="httpPort" type="number" placeholder="5500" min="1" max="65535" />
          </SFormItem>
          <SFormItem :label="t('settings.http_url')">
            <SInput v-model="httpUrl" type="text" placeholder="http://localhost:5500" />
          </SFormItem>
          <SFormItem :label="t('settings.max_image_size')" :hint="t('settings.max_image_size_hint')">
            <SInput v-model.number="maxImageSize" type="number" placeholder="1024" min="0" />
          </SFormItem>
        </div>
      </SCard>
      <SCard :title="t('settings.context_discovery')">
        <div class="form-hint">{{ t('settings.context_discovery_hint') }}</div>
        <div
          v-for="(_, index) in contextFileNames"
          :key="index"
          class="draggable-row"
          :class="{ 'drag-over': contextDrag.dropIndex === index && contextDrag.dragIndex !== index, 'dragging': contextDrag.dragIndex === index }"
          draggable="true"
          @dragstart="onDragStart(contextDrag, index, $event)"
          @dragover="onDragOver(contextDrag, index, $event)"
          @dragleave="onDragLeave(contextDrag)"
          @drop="onDrop(contextDrag, contextFileNames as any, index)"
          @dragend="onDragEnd(contextDrag)"
        >
          <span class="drag-handle" :title="t('settings.startup_commands_drag')">⠿</span>
          <SInput v-model="contextFileNames[index]" type="text" :placeholder="t('settings.context_file_names_placeholder')" class="draggable-row-input" />
          <SButton type="text" size="sm" :title="t('common.delete')" class="draggable-row-remove" @click="removeContextFileName(index)">✕</SButton>
        </div>
        <SButton type="outline" size="sm" @click="addContextFileName">{{ t('settings.context_file_names_add') }}</SButton>
      </SCard>
      <SCard :title="t('settings.tool_approval')">
        <SCheckCard v-model="autoApproveAllTools">
          {{ t('settings.auto_approve_all') }}
        </SCheckCard>
        <div class="form-hint" style="margin-top:6px">{{ t('settings.auto_approve_all_hint') }}</div>
      </SCard>
      <SCard :title="t('settings.startup_commands')">
        <div class="form-hint">{{ t('settings.startup_commands_hint') }}</div>
        <div
          v-for="(_, index) in startupCommands"
          :key="index"
          class="draggable-row"
          :class="{ 'drag-over': startupDrag.dropIndex === index && startupDrag.dragIndex !== index, 'dragging': startupDrag.dragIndex === index }"
          draggable="true"
          @dragstart="onDragStart(startupDrag, index, $event)"
          @dragover="onDragOver(startupDrag, index, $event)"
          @dragleave="onDragLeave(startupDrag)"
          @drop="onDrop(startupDrag, startupCommands as any, index)"
          @dragend="onDragEnd(startupDrag)"
        >
          <span class="drag-handle" :title="t('settings.startup_commands_drag')">⠿</span>
          <STextarea v-model="startupCommands[index]" :rows="3" :placeholder="t('settings.startup_commands_placeholder')" class="draggable-row-input draggable-row-textarea" />
          <SButton type="text" size="sm" :title="t('common.delete')" class="draggable-row-remove" @click="removeStartupCommand(index)">✕</SButton>
        </div>
        <SButton type="outline" size="sm" @click="addStartupCommand">{{ t('settings.startup_commands_add') }}</SButton>
      </SCard>
      <SCard :title="t('settings.scan_invalid_data')">
        <div class="form-hint">{{ t('settings.scan_invalid_data_hint') }}</div>
        <div class="cleanup-actions">
          <SButton type="outline" size="sm" :disabled="cleanupLoading" @click="scanCleanup">
            {{ cleanupReport ? t('settings.cleanup_rescan') : t('settings.cleanup_scan') }}
          </SButton>
          <SButton
            v-if="cleanupReport && cleanableCount > 0"
            type="primary"
            size="sm"
            :disabled="cleanupLoading"
            @click="applyCleanup"
          >
            {{ t('settings.cleanup_apply', { n: cleanableCount }) }}
          </SButton>
        </div>
        <div v-if="cleanupReport" class="cleanup-report">
          <div v-if="issuesCount === 0" class="cleanup-empty">
            ✓ {{ t('settings.cleanup_clean') }}
          </div>
          <div
            v-for="cat in cleanupCategories"
            :key="cat.key"
            class="cleanup-cat"
            :class="{ 'cleanup-cat-empty': cat.items.length === 0 }"
          >
            <div class="cleanup-cat-head" @click="cleanupExpand[cat.key] = !cleanupExpand[cat.key]">
              <span class="cleanup-cat-toggle">{{ cleanupExpand[cat.key] ? '▼' : '▶' }}</span>
              <span class="cleanup-cat-label">{{ cat.label }}</span>
              <span class="cleanup-cat-count" :class="{ 'cleanup-cat-count-zero': cat.items.length === 0 }">
                {{ cat.items.length }}
              </span>
              <span v-if="!cat.cleaned && cat.items.length > 0" class="cleanup-cat-tag">
                {{ t('settings.cleanup_listed_only') }}
              </span>
            </div>
            <div v-if="cleanupExpand[cat.key] && cat.items.length > 0" class="cleanup-cat-items">
              <div v-for="(item, idx) in cat.items" :key="idx" class="cleanup-cat-item">
                {{ fmtItem(cat.key, item) }}
              </div>
            </div>
          </div>
        </div>
      </SCard>
    </SPageContent>
  </div>
</template>

<style scoped>
.form-hint {
  font-size: var(--sui-fs-sm);
  color: var(--sui-fg-muted);
  margin-bottom: var(--sui-sp-3);
}
.port-mismatch-banner {
  background: var(--sui-warning-bg);
  border-bottom: 1px solid var(--sui-warning-fg);
  color: var(--sui-warning-fg);
  font-size: var(--sui-fs-md);
  padding: var(--sui-sp-3) var(--sui-sp-7);
  text-align: center;
}

.draggable-row {
  display: flex;
  gap: var(--sui-sp-3);
  align-items: flex-start;
  margin-bottom: var(--sui-sp-3);
  border-radius: var(--sui-radius-sm);
  transition: background 0.15s, opacity 0.15s;
}
.draggable-row.dragging {
  opacity: 0.4;
}
.draggable-row.drag-over {
  background: var(--sui-info-soft);
  box-shadow: 0 -2px 0 0 var(--sui-info) inset;
}
.drag-handle {
  cursor: grab;
  user-select: none;
  padding: var(--sui-sp-2) 2px;
  color: var(--sui-fg-muted);
  font-size: var(--sui-fs-xl);
  line-height: 1;
  flex-shrink: 0;
}
.drag-handle:active {
  cursor: grabbing;
}
.draggable-row-input {
  flex: 1;
}
.draggable-row-textarea :deep(textarea) {
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-md);
}
.draggable-row-remove {
  flex-shrink: 0;
}

.inline-form { display: flex; gap: var(--sui-sp-7); flex-wrap: wrap; }
.inline-form > * { flex: 1; min-width: 200px; }

@media (max-width: 768px) {
  .inline-form { flex-direction: column; }
}

.cleanup-actions {
  display: flex;
  gap: var(--sui-sp-3);
  margin-bottom: var(--sui-sp-3);
}
.cleanup-report {
  margin-top: var(--sui-sp-3);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg-soft);
}
.cleanup-empty {
  padding: var(--sui-sp-3);
  color: var(--sui-success);
  font-size: var(--sui-fs-sm);
}
.cleanup-cat {
  border-bottom: 1px solid var(--sui-border);
}
.cleanup-cat:last-child {
  border-bottom: none;
}
.cleanup-cat-head {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
  padding: var(--sui-sp-2) var(--sui-sp-3);
  cursor: pointer;
  user-select: none;
  font-size: var(--sui-fs-sm);
}
.cleanup-cat-empty .cleanup-cat-head {
  cursor: default;
  color: var(--sui-fg-muted);
}
.cleanup-cat-toggle {
  width: 12px;
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-muted);
}
.cleanup-cat-empty .cleanup-cat-toggle {
  visibility: hidden;
}
.cleanup-cat-label {
  flex: 1;
}
.cleanup-cat-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  padding: 0 6px;
  height: 20px;
  border-radius: 10px;
  background: var(--sui-warning-soft);
  color: var(--sui-warning-fg);
  font-size: var(--sui-fs-xs);
  font-weight: 600;
}
.cleanup-cat-count-zero {
  background: var(--sui-bg-active);
  color: var(--sui-fg-muted);
  font-weight: normal;
}
.cleanup-cat-tag {
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg-muted);
  font-style: italic;
}
.cleanup-cat-items {
  background: var(--sui-bg);
  border-top: 1px solid var(--sui-border);
  max-height: 300px;
  overflow-y: auto;
}
.cleanup-cat-item {
  padding: 4px var(--sui-sp-3) 4px 28px;
  font-family: var(--sui-font-mono);
  font-size: var(--sui-fs-xs);
  color: var(--sui-fg);
  border-bottom: 1px solid var(--sui-border-soft, var(--sui-border));
}
.cleanup-cat-item:last-child {
  border-bottom: none;
}
</style>
