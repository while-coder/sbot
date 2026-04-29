# ChatView Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all chat UI from website into `@sbot/chat-ui` so website/PWA/VSCode share a single `ChatView` component.

**Architecture:** Extend `IChatTransport` with session CRUD, history, usage, FS, approval/ask methods. Build new components (SessionBar, ConfigToolbar, StatusBar, ChatArea, modals) inside chat-ui. Each platform only implements `IChatTransport` and imports `<ChatView :transport="t" />`.

**Tech Stack:** Vue 3.5 Composition API, TypeScript, CSS custom properties for theming, `sbot.commons` for shared event types.

---

## Task 1: Extend types.ts with all new interfaces

**Files:**
- Modify: `packages/chat-ui/src/types.ts`

**Step 1: Add new types to types.ts**

Append after the existing `ChatState` interface at line 134:

```typescript
// ── Wiki option ──
export interface WikiOption { id: string; name: string }

// ── Create session ──
export interface CreateSessionOpts {
  agent: string
  saver: string
  memories?: string[]
  wikis?: string[]
  name?: string
}

// ── Token usage ──
export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastInputTokens: number
  lastOutputTokens: number
  lastTotalTokens: number
}

export interface UsageData {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// ── Tool approval ──
export interface ToolCallEvent {
  approvalId: string
  toolCallId?: string
  name: string
  args: Record<string, any>
}

export type ToolApprovalType = 'allow' | 'alwaysArgs' | 'alwaysTool' | 'deny'

export interface ToolApprovalPayload {
  approvalId: string
  approval: ToolApprovalType
}

// ── Ask form ──
export enum AskQuestionType {
  Radio    = 'radio',
  Checkbox = 'checkbox',
  Input    = 'input',
}

export interface AskQuestionSpec {
  type: AskQuestionType
  label: string
  options?: string[]
  placeholder?: string
}

export interface AskEvent {
  id: string
  title?: string
  questions: AskQuestionSpec[]
  startedAt?: string
}

export interface AskAnswerPayload {
  askId: string
  answers: Record<string, string | string[]>
}

// ── Queued messages ──
export type DisplayContent = string | any[]

// ── Directory browser ──
export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export interface DirListResult {
  path: string
  parent: string | null
  items: string[]
}

export interface QuickDir {
  label: string
  path: string
}

// ── App settings ──
export interface AppSettings {
  agents: Record<string, { name?: string; type?: string; model?: string }>
  savers: Record<string, { name: string }>
  memories: Record<string, { name: string; share?: boolean }>
  wikis: Record<string, { name: string }>
  models?: Record<string, { contextWindow?: number }>
}

// ── Session status (pending state on reconnect) ──
export interface SessionStatus {
  pendingApproval?: {
    id: string
    tool: { id?: string; name: string; args: Record<string, any> }
    startedAt: string
  }
  pendingAsk?: AskEvent & { startedAt: string }
  pendingMessages?: DisplayContent[]
}

// ── Chat events (server → client) ──
export type ChatEvent =
  | { type: 'connectionStatus'; online: boolean }
  | { type: 'human'; data: { content: DisplayContent } }
  | { type: 'stream'; data: { content: DisplayContent } }
  | { type: 'message'; data: { message: ChatMessage; thinkId?: string; createdAt: number } }
  | { type: 'toolCall'; data: ToolCallEvent }
  | { type: 'ask'; data: AskEvent }
  | { type: 'queue'; data: { pendingMessages: DisplayContent[] } }
  | { type: 'done'; data: { pendingMessages?: DisplayContent[] } }
  | { type: 'error'; data: { message: string } }
  | { type: 'usage'; data: UsageData }
```

**Step 2: Extend SessionItem**

Replace the existing `SessionItem` interface (line 7-14) with:

```typescript
export interface SessionItem {
  id: string
  name?: string
  agent: string
  saver: string
  memories: string[]
  wikis?: string[]
  workPath?: string
  autoApproveAllTools?: boolean
}
```

**Step 3: Commit**

```
feat(chat-ui): add types for transport, events, sessions, approval, ask, usage
```

---

## Task 2: Define new IChatTransport interface

**Files:**
- Modify: `packages/chat-ui/src/transport.ts`

**Step 1: Replace IChatTransport**

Replace the existing `IChatTransport` interface (lines 4-17) with the new expanded version. Keep `useChat` and `ChatInstance` for backward compat but mark deprecated:

```typescript
import { reactive } from 'vue';
import type {
  ChatState, ContentPart, Attachment,
  SessionItem, CreateSessionOpts, StoredMessage,
  UsageInfo, AppSettings, SessionStatus,
  ToolApprovalPayload, AskAnswerPayload,
  DirListResult, QuickDir, ChatEvent,
} from './types';

export interface IChatTransport {
  // ── Connection lifecycle ──
  connect(): void
  disconnect(): void
  onEvent(handler: (event: ChatEvent) => void): void
  offEvent(handler: (event: ChatEvent) => void): void

  // ── Session CRUD ──
  listSessions(): Promise<Record<string, SessionItem>>
  createSession(opts: CreateSessionOpts): Promise<{ id: string }>
  deleteSession(sessionId: string): Promise<void>
  updateSession(sessionId: string, patch: Partial<SessionItem>): Promise<void>

  // ── Messages ──
  sendMessage(sessionId: string, parts: ContentPart[], attachments?: Attachment[]): void
  getHistory(sessionId: string): Promise<StoredMessage[]>
  clearHistory(sessionId: string): Promise<void>

  // ── Token usage ──
  getUsage(sessionId: string): Promise<UsageInfo | null>

  // ── Tool approval / Ask ──
  approveToolCall(sessionId: string, payload: ToolApprovalPayload): void
  answerAsk(sessionId: string, payload: AskAnswerPayload): void
  abort(sessionId: string): void

  // ── Configuration ──
  getSettings(): Promise<AppSettings>
  getSessionStatus(sessionId: string): Promise<SessionStatus | null>

  // ── File system (for path picker) ──
  listDir(dir?: string): Promise<DirListResult>
  quickDirs(): Promise<QuickDir[]>
  mkdir(path: string): Promise<{ path: string }>

  // ── Thinks ──
  getThinksUrlPrefix(sessionId: string): string | null
  fetchThinks?(url: string): Promise<any>
}
```

**Step 2: Keep old useChat/ChatInstance as deprecated exports**

Leave the existing `useChat` function and `ChatInstance` type but do NOT delete them — the old ChatApp/ServerPicker may still reference them. They'll be cleaned up in a later task.

**Step 3: Commit**

```
feat(chat-ui): extend IChatTransport with full session/history/usage/approval API
```

---

## Task 3: Extend ChatLabels for new UI strings

**Files:**
- Modify: `packages/chat-ui/src/types.ts` (ChatLabels interface, line 78-113)
- Modify: `packages/chat-ui/src/labels.ts` (defaultLabels, line 3-39)

**Step 1: Add new keys to ChatLabels**

Add these keys to the `ChatLabels` interface:

```typescript
// Session bar
newSession?: string
confirmDeleteSession?: string
sessionDeleted?: string
emptySession?: string
createSessionHint?: string
editSessionNameHint?: string

// Config toolbar
agent?: string
storage?: string
workpath?: string
workpathPlaceholder?: string
memory?: string
wiki?: string
autoApproveAll?: string
view?: string

// Status bar
usageLast?: string
usageTotal?: string
refresh?: string
clearHistory?: string
confirmClearHistory?: string
historyCleared?: string

// New session modal
newSessionTitle?: string
errorNoAgent?: string
errorNoSaver?: string
selectPlaceholder?: string
create?: string

// Tool approval
executeTool?: string
allow?: string
alwaysAllowArgs?: string
alwaysAllowAll?: string
deny?: string

// Ask form
askSubmit?: string
askOther?: string
askOtherPlaceholder?: string

// Path picker
selectDirTitle?: string
myComputer?: string
upDir?: string
newFolder?: string
newFolderPlaceholder?: string
selectThis?: string
noSubdirs?: string

// Misc
noSession?: string
noSaver?: string
selectOrCreate?: string
```

**Step 2: Add defaults to labels.ts**

Add matching Chinese defaults to `defaultLabels`:

```typescript
// Session bar
newSession: '新建会话',
confirmDeleteSession: '确定删除会话 "{name}"?',
sessionDeleted: '会话已删除',
emptySession: '暂无会话',
createSessionHint: '点击上方新建',
editSessionNameHint: '双击编辑名称',

// Config toolbar
agent: 'Agent',
storage: '存储',
workpath: '工作目录',
workpathPlaceholder: '选择工作目录',
memory: '记忆',
wiki: 'Wiki',
autoApproveAll: '自动审批',
view: '查看',

// Status bar
usageLast: 'Last',
usageTotal: 'Total',
refresh: '刷新',
clearHistory: '清除历史',
confirmClearHistory: '确定清除所有历史记录?',
historyCleared: '历史记录已清除',

// New session modal
newSessionTitle: '新建会话',
errorNoAgent: '请选择 Agent',
errorNoSaver: '请选择存储',
selectPlaceholder: '请选择…',
create: '创建',

// Tool approval
executeTool: '执行工具: ',
allow: '允许',
alwaysAllowArgs: '始终允许(参数)',
alwaysAllowAll: '始终允许(工具)',
deny: '拒绝',

// Ask form
askSubmit: '提交',
askOther: '其他',
askOtherPlaceholder: '输入自定义内容',

// Path picker
selectDirTitle: '选择目录',
myComputer: '我的电脑',
upDir: '↑ 上级目录',
newFolder: '新建文件夹',
newFolderPlaceholder: '文件夹名称',
selectThis: '选择此目录',
noSubdirs: '没有子目录',

// Misc
noSession: '请先选择或创建会话',
noSaver: '未配置存储，无法发送',
selectOrCreate: '← 请选择或创建会话',
```

**Step 3: Commit**

```
feat(chat-ui): add label keys for session bar, toolbar, status bar, modals, approval, ask
```

---

## Task 4: Create MultiSelect.vue component

**Files:**
- Create: `packages/chat-ui/src/components/MultiSelect.vue`

**Step 1: Create the component**

Port from `packages/website/src/components/MultiSelect.vue` (155 lines), replacing hardcoded colors with CSS variables:

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface Option { id: string; label: string }

const props = defineProps<{
  options: Option[]
  modelValue: string[]
  placeholder?: string
  compact?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const open = ref(false)
const root = ref<HTMLElement>()

const selectedLabels = computed(() =>
  props.options.filter(o => props.modelValue.includes(o.id)).map(o => o.label)
)

function toggle(id: string) {
  const cur = props.modelValue
  emit('update:modelValue', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
}

function onOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onOutside))
onUnmounted(() => document.removeEventListener('mousedown', onOutside))
</script>

<template>
  <div ref="root" class="chatui-ms-root" :class="{ compact, open }">
    <button type="button" class="chatui-ms-trigger" @click="open = !open">
      <span class="chatui-ms-value">
        <template v-if="selectedLabels.length">
          <span v-for="label in selectedLabels" :key="label" class="chatui-ms-chip">{{ label }}</span>
        </template>
        <span v-else class="chatui-ms-placeholder">{{ placeholder ?? '—' }}</span>
      </span>
      <svg class="chatui-ms-arrow" viewBox="0 0 10 6" width="10" height="6">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>
    </button>
    <div v-if="open" class="chatui-ms-dropdown">
      <div v-if="options.length === 0" class="chatui-ms-empty">—</div>
      <label
        v-for="opt in options"
        :key="opt.id"
        class="chatui-ms-option"
        :class="{ checked: modelValue.includes(opt.id) }"
      >
        <input type="checkbox" :checked="modelValue.includes(opt.id)" @change="toggle(opt.id)" />
        <span>{{ opt.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.chatui-ms-root { position: relative; display: inline-flex; flex-direction: column; }
.chatui-ms-trigger {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 8px 5px 10px; border: 1px solid var(--chatui-border, #d4d2ce);
  border-radius: 6px; background: var(--chatui-bg-surface, #fff);
  cursor: pointer; text-align: left; min-height: 32px; gap: 6px;
  color: var(--chatui-fg, #1c1c1c); font-size: inherit; font-family: inherit;
}
.chatui-ms-root.compact .chatui-ms-trigger { min-height: 26px; padding: 3px 6px 3px 8px; }
.chatui-ms-trigger:hover, .chatui-ms-root.open .chatui-ms-trigger { border-color: var(--chatui-border-focus, #999); }
.chatui-ms-value { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
.chatui-ms-chip {
  background: var(--chatui-chip-bg, #1c1c1c); color: var(--chatui-chip-fg, #fff);
  font-size: 12px; padding: 1px 7px; border-radius: 99px; white-space: nowrap;
}
.chatui-ms-root.compact .chatui-ms-chip { font-size: 11px; padding: 0 6px; }
.chatui-ms-placeholder { font-size: 13px; color: var(--chatui-fg-secondary, #aaa); line-height: 1.6; }
.chatui-ms-arrow { color: var(--chatui-fg-secondary, #999); flex-shrink: 0; transition: transform .15s; }
.chatui-ms-root.open .chatui-ms-arrow { transform: rotate(180deg); }
.chatui-ms-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; min-width: 100%; width: max-content;
  background: var(--chatui-bg-surface, #fff); border: 1px solid var(--chatui-border, #d4d2ce);
  border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.1); z-index: 100;
  max-height: 200px; overflow-y: auto;
}
.chatui-ms-option {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  cursor: pointer; font-size: 13px; color: var(--chatui-fg, #1c1c1c);
  border-bottom: 1px solid var(--chatui-border-subtle, #f0eeeb); user-select: none;
}
.chatui-ms-option:last-child { border-bottom: none; }
.chatui-ms-option:hover { background: var(--chatui-bg-hover, #f8f7f6); }
.chatui-ms-option.checked { background: var(--chatui-bg-active, #f4f4f4); font-weight: 500; }
.chatui-ms-option input[type="checkbox"] {
  margin: 0; flex-shrink: 0; accent-color: var(--chatui-accent, #1c1c1c);
  width: 14px; height: 14px; cursor: pointer;
}
.chatui-ms-empty { padding: 8px 12px; font-size: 13px; color: var(--chatui-fg-secondary, #94a3b8); }
</style>
```

**Step 2: Commit**

```
feat(chat-ui): add MultiSelect component
```

---

## Task 5: Create PathPickerModal.vue

**Files:**
- Create: `packages/chat-ui/src/components/PathPickerModal.vue`

**Step 1: Create the component**

Port from `packages/website/src/views/modals/PathPickerModal.vue`. Instead of `apiFetch`, accept a `transport` prop (IChatTransport) and call `transport.listDir()`, `transport.mkdir()`, `transport.quickDirs()`.

```vue
<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import type { IChatTransport } from '../transport'
import type { ChatLabels } from '../types'
import { resolveLabels } from '../labels'

const props = defineProps<{
  transport: IChatTransport
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const emit = defineEmits<{ confirm: [path: string] }>()

const pickerOpen    = ref(false)
const pickerLoading = ref(false)
const pickerPath    = ref('')
const pickerParent  = ref<string | null>(null)
const pickerItems   = ref<string[]>([])
const pickerCreating  = ref(false)
const pickerNewName   = ref('')
const newNameInput    = ref<HTMLInputElement | null>(null)
const pickerQuickDirs = ref<{ label: string; path: string }[]>([])

function itemLabel(p: string): string {
  if (/^[A-Za-z]:[/\\]?$/.test(p)) return p.replace(/[/\\]$/, '') + '\\'
  const trimmed = p.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).filter(Boolean).pop() || p
}

async function navigatePicker(dir: string): Promise<boolean> {
  pickerCreating.value = false
  pickerNewName.value  = ''
  pickerLoading.value  = true
  try {
    const res = await props.transport.listDir(dir || undefined)
    pickerPath.value   = res.path
    pickerParent.value = res.parent
    pickerItems.value  = res.items
    return true
  } catch {
    return false
  } finally {
    pickerLoading.value = false
  }
}

function startCreate() {
  pickerCreating.value = true
  pickerNewName.value  = ''
  nextTick(() => newNameInput.value?.focus())
}

function cancelCreate() {
  pickerCreating.value = false
  pickerNewName.value  = ''
}

async function confirmCreate() {
  const name = pickerNewName.value.trim()
  if (!name) return
  try {
    const res = await props.transport.mkdir(`${pickerPath.value}/${name}`)
    await navigatePicker(res.path)
  } catch { /* handled by transport */ }
}

async function open(initialPath = '') {
  pickerPath.value      = ''
  pickerParent.value    = null
  pickerItems.value     = []
  pickerQuickDirs.value = []
  pickerOpen.value      = true
  props.transport.quickDirs().then(dirs => { pickerQuickDirs.value = dirs }).catch(() => {})
  if (initialPath && await navigatePicker(initialPath)) return
  await navigatePicker('')
}

function confirmPicker() {
  if (!pickerPath.value) return
  pickerOpen.value = false
  emit('confirm', pickerPath.value)
}

defineExpose({ open })
</script>

<template>
  <div v-if="pickerOpen" class="chatui-modal-overlay" @click.self="pickerOpen = false">
    <div class="chatui-modal-box chatui-picker-box">
      <div class="chatui-modal-header">
        <h3>{{ L.selectDirTitle }}</h3>
        <button class="chatui-modal-close" @click="pickerOpen = false">&times;</button>
      </div>

      <div class="chatui-picker-path-bar">{{ pickerPath || L.myComputer }}</div>

      <div v-if="pickerQuickDirs.length" class="chatui-picker-quickdirs">
        <button
          v-for="d in pickerQuickDirs" :key="d.path"
          class="chatui-picker-quickdir-chip"
          :class="{ active: pickerPath === d.path }"
          @click="navigatePicker(d.path)"
        >{{ d.label }}</button>
      </div>

      <div class="chatui-picker-list">
        <div v-if="pickerLoading" class="chatui-picker-empty">{{ L.loading }}</div>
        <template v-else>
          <div v-if="pickerParent !== null" class="chatui-picker-item chatui-picker-up" @click="navigatePicker(pickerParent!)">
            {{ L.upDir }}
          </div>
          <div v-if="pickerCreating" class="chatui-picker-create-row">
            <span class="chatui-picker-icon">▶</span>
            <input ref="newNameInput" v-model="pickerNewName" class="chatui-picker-create-input"
              :placeholder="L.newFolderPlaceholder" @keydown.enter="confirmCreate" @keydown.escape="cancelCreate" />
            <button class="chatui-picker-create-btn" @click="confirmCreate">✓</button>
            <button class="chatui-picker-create-btn chatui-picker-create-cancel" @click="cancelCreate">✕</button>
          </div>
          <div v-if="pickerItems.length === 0 && !pickerCreating" class="chatui-picker-empty">{{ L.noSubdirs }}</div>
          <div v-for="item in pickerItems" :key="item" class="chatui-picker-item" @click="navigatePicker(item)">
            <span class="chatui-picker-icon">▶</span>{{ itemLabel(item) }}
          </div>
        </template>
      </div>

      <div class="chatui-modal-footer">
        <button class="chatui-btn-outline chatui-btn-sm" style="margin-right:auto" :disabled="!pickerPath || pickerCreating" @click="startCreate">{{ L.newFolder }}</button>
        <button class="chatui-btn-outline" @click="pickerOpen = false">{{ L.cancel }}</button>
        <button class="chatui-btn-primary" :disabled="!pickerPath" @click="confirmPicker">{{ L.selectThis }}</button>
      </div>
    </div>
  </div>
</template>
```

CSS: use `--chatui-*` variables throughout. (Follow same pattern as website but with variables.)

**Step 2: Commit**

```
feat(chat-ui): add PathPickerModal component with transport-based FS access
```

---

## Task 6: Create NewSessionModal.vue

**Files:**
- Create: `packages/chat-ui/src/components/NewSessionModal.vue`

**Step 1: Create the component**

Port from `packages/website/src/views/modals/NewSessionModal.vue`. Replace `apiFetch`/`store` with transport calls. Accept `transport` + `settings` props.

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { IChatTransport } from '../transport'
import type { ChatLabels, AppSettings } from '../types'
import { resolveLabels } from '../labels'
import MultiSelect from './MultiSelect.vue'

const props = defineProps<{
  transport: IChatTransport
  settings: AppSettings
  labels?: ChatLabels
}>()

const L = computed(() => resolveLabels(props.labels))
const emit = defineEmits<{ created: [sessionId: string] }>()

const showModal = ref(false)
const saving = ref(false)
const form = ref({ agent: '', saver: '', memories: [] as string[], wikis: [] as string[] })

const agentOptions = computed(() =>
  Object.entries(props.settings.agents || {}).map(([id, a]) => ({ id, label: a.name || id, type: (a as any).type || '' }))
)
const saverOptions = computed(() =>
  Object.entries(props.settings.savers || {}).map(([id, s]) => ({ id, label: s.name || id }))
)
const memoryOptions = computed(() =>
  Object.entries(props.settings.memories || {}).map(([id, m]) => ({ id, label: m.name || id }))
)
const wikiOptions = computed(() =>
  Object.entries(props.settings.wikis || {}).map(([id, w]) => ({ id, label: w.name || id }))
)

function open() {
  form.value = { agent: '', saver: '', memories: [], wikis: [] }
  showModal.value = true
}

function autoName(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function create() {
  if (!form.value.agent) return
  if (!form.value.saver) return
  saving.value = true
  try {
    const res = await props.transport.createSession({
      name: autoName(),
      agent: form.value.agent,
      saver: form.value.saver,
      memories: form.value.memories,
      wikis: form.value.wikis,
    })
    showModal.value = false
    emit('created', res.id)
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <div v-if="showModal" class="chatui-modal-overlay" @click.self="showModal = false">
    <div class="chatui-modal-box">
      <div class="chatui-modal-header">
        <h3>{{ L.newSessionTitle }}</h3>
        <button class="chatui-modal-close" @click="showModal = false">&times;</button>
      </div>
      <div class="chatui-modal-body">
        <div class="chatui-form-group">
          <label>{{ L.agent }} *</label>
          <select v-model="form.agent">
            <option value="" disabled>{{ L.selectPlaceholder }}</option>
            <option v-for="a in agentOptions" :key="a.id" :value="a.id">{{ a.label }}{{ a.type ? ` (${a.type})` : '' }}</option>
          </select>
        </div>
        <div class="chatui-form-group">
          <label>{{ L.storage }} *</label>
          <select v-model="form.saver">
            <option value="" disabled>{{ L.selectPlaceholder }}</option>
            <option v-for="s in saverOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="chatui-form-group">
          <label>{{ L.memory }}</label>
          <MultiSelect v-model="form.memories" :options="memoryOptions" />
        </div>
        <div class="chatui-form-group">
          <label>{{ L.wiki }}</label>
          <MultiSelect v-model="form.wikis" :options="wikiOptions" />
        </div>
      </div>
      <div class="chatui-modal-footer">
        <button class="chatui-btn-outline" @click="showModal = false">{{ L.cancel }}</button>
        <button class="chatui-btn-primary" :disabled="saving" @click="create">{{ L.create }}</button>
      </div>
    </div>
  </div>
</template>
```

**Step 2: Commit**

```
feat(chat-ui): add NewSessionModal component
```

---

## Task 7: Create ToolApprovalBar.vue and AskForm.vue

**Files:**
- Create: `packages/chat-ui/src/components/ToolApprovalBar.vue`
- Create: `packages/chat-ui/src/components/AskForm.vue`

**Step 1: Create ToolApprovalBar.vue**

Port the tool approval bar from `packages/website/src/components/ChatArea.vue` (lines 320-340, plus logic from lines 80-128). Component owns its own countdown timer.

Props: `toolCall: ToolCallEvent`, `labels?: ChatLabels`, `initialCountdown?: number`
Emits: `approve: [payload: ToolApprovalPayload]`

Includes: expandable args display, 4 approval buttons (allow, alwaysArgs, alwaysTool, deny), countdown on deny button.

**Step 2: Create AskForm.vue**

Port ask form from `packages/website/src/components/ChatArea.vue` (lines 284-318, plus logic from lines 42-78). Component owns its own countdown timer.

Props: `askEvent: AskEvent`, `labels?: ChatLabels`, `initialCountdown?: number`
Emits: `submit: [payload: AskAnswerPayload]`

Includes: radio/checkbox/text question types, custom input ("Other") option, countdown on submit button.

**Step 3: Commit**

```
feat(chat-ui): add ToolApprovalBar and AskForm components
```

---

## Task 8: Create SessionBar.vue

**Files:**
- Create: `packages/chat-ui/src/components/SessionBar.vue`

**Step 1: Create the component**

Port session sidebar from `packages/website/src/views/ChatView.vue` (lines 210-254). Props-driven, no direct API calls.

Props:
```typescript
sessions: Record<string, SessionItem>
activeSessionId: string | null
labels?: ChatLabels
```

Emits:
```typescript
'select': [id: string]
'delete': [id: string]
'rename': [id: string, name: string]
'newSession': []
```

Features:
- Session list with click-to-select
- Inline name editing (double-click → input → blur/Enter to commit)
- Delete button (× appears on hover)
- "New session" button at top
- Empty state text
- Shows workPath under session name

**Step 2: Commit**

```
feat(chat-ui): add SessionBar component
```

---

## Task 9: Create ConfigToolbar.vue

**Files:**
- Create: `packages/chat-ui/src/components/ConfigToolbar.vue`

**Step 1: Create the component**

Port config toolbar from `packages/website/src/views/ChatView.vue` (lines 260-346).

Props:
```typescript
session: SessionItem | null
settings: AppSettings
labels?: ChatLabels
```

Emits:
```typescript
'updateConfig': [field: string, value: any]
'openPathPicker': [currentPath: string]
```

Contains: Agent select, Saver select, WorkPath display + button, Memory MultiSelect, Wiki MultiSelect, AutoApprove checkbox.

**Step 2: Commit**

```
feat(chat-ui): add ConfigToolbar component
```

---

## Task 10: Create StatusBar.vue

**Files:**
- Create: `packages/chat-ui/src/components/StatusBar.vue`

**Step 1: Create the component**

Port status row from `packages/website/src/views/ChatView.vue` (lines 349-376).

Props:
```typescript
usage: UsageInfo | null
contextWindow?: number
labels?: ChatLabels
hasSaver: boolean
```

Emits:
```typescript
'refresh': []
'clearHistory': []
```

Contains: Context window percentage bar (green/yellow/red), last usage, total usage, refresh button, clear history button.

**Step 2: Commit**

```
feat(chat-ui): add StatusBar component
```

---

## Task 11: Create ChatArea.vue (new)

**Files:**
- Create: `packages/chat-ui/src/components/ChatArea.vue`

**Step 1: Create the component**

Port and merge logic from:
- `packages/website/src/components/ChatArea.vue` (WS event handling, approval/ask state)
- `packages/website/src/components/ChatPanel.vue` (input bar, attachments, scroll)
- Current `packages/chat-ui/src/components/ChatView.vue` (input bar, attachments — reuse)

This is the core chat area that handles: message list display, streaming, tool approval bar, ask form, queued messages, input bar, stop button.

Props:
```typescript
messages: StoredMessage[]
isStreaming: boolean
streamingContent: string | any[]
queuedMessages?: DisplayContent[]
pendingToolCall?: ToolCallEvent | null
pendingAsk?: AskEvent | null
toolCallCountdown?: number
askCountdown?: number
thinksUrlPrefix?: string | null
labels?: ChatLabels
fetchFn?: (url: string) => Promise<any>
showAttachments?: boolean
onCancel?: () => void
```

Emits:
```typescript
'send': [parts: ContentPart[], attachments: Attachment[]]
'approveToolCall': [payload: ToolApprovalPayload]
'answerAsk': [payload: AskAnswerPayload]
```

Uses: MessageList, RichInput, ToolApprovalBar, AskForm (all from chat-ui).

Exposes: `scrollToBottom(force?: boolean)`

**Step 2: Commit**

```
feat(chat-ui): add ChatArea component with approval/ask/queue support
```

---

## Task 12: Rewrite ChatView.vue as the unified full-page component

**Files:**
- Modify: `packages/chat-ui/src/components/ChatView.vue` (full rewrite)

**Step 1: Rewrite ChatView**

This is the main integration point. It orchestrates all sub-components and manages all state via the transport.

Props:
```typescript
transport: IChatTransport
labels?: ChatLabels
showAttachments?: boolean
```

Internal state:
- `sessions: Record<string, SessionItem>` — from transport.listSessions()
- `activeSessionId: string | null`
- `settings: AppSettings` — from transport.getSettings()
- `messages: StoredMessage[]` — from transport.getHistory()
- `isStreaming`, `streamingContent` — from transport events
- `pendingToolCall`, `pendingAsk`, `queuedMessages` — from transport events
- `sessionUsage: UsageInfo | null` — from transport.getUsage()
- `online: boolean` — from transport connection status events
- Countdown timers for tool approval and ask

Lifecycle:
- `onMounted`: transport.connect(), transport.getSettings(), transport.listSessions(), transport.onEvent(handleEvent)
- `onUnmounted`: transport.disconnect(), transport.offEvent(handleEvent), cleanup timers

Event handler `handleEvent(evt: ChatEvent)`:
- `connectionStatus` → update online flag
- `human` → shift queued, push human message
- `stream` → update streamingContent
- `message` → push to messages, clear streaming
- `toolCall` → set pendingToolCall, start countdown
- `ask` → set pendingAsk, start countdown
- `queue` → update queuedMessages
- `done` → clear streaming/pending, optionally keep queue
- `error` → clear all pending state
- `usage` → update sessionUsage incrementally

Session switching:
- On activeSessionId change: transport.getHistory(), transport.getUsage(), transport.getSessionStatus() → restore pending state

Template structure:
```
<div class="chatui-view">
  <SessionBar />
  <div class="chatui-main">
    <ConfigToolbar />
    <StatusBar />
    <ChatArea />
  </div>
  <PathPickerModal />
  <NewSessionModal />
</div>
```

**Step 2: Commit**

```
feat(chat-ui): rewrite ChatView as full unified chat page
```

---

## Task 13: Create CSS theme files

**Files:**
- Create: `packages/chat-ui/src/themes/variables.css`
- Create: `packages/chat-ui/src/themes/theme-web.css`
- Create: `packages/chat-ui/src/themes/theme-vscode.css`
- Create: `packages/chat-ui/src/themes/theme-pwa.css`

**Step 1: Create variables.css**

Define all `--chatui-*` variables with sensible neutral defaults:

```css
:root {
  /* Colors */
  --chatui-bg: #ffffff;
  --chatui-bg-surface: #ffffff;
  --chatui-bg-hover: #f8f7f6;
  --chatui-bg-active: #f0efed;
  --chatui-fg: #1c1c1c;
  --chatui-fg-secondary: #94a3b8;
  --chatui-border: #e8e6e3;
  --chatui-border-subtle: #f0eeeb;
  --chatui-border-focus: #999999;
  --chatui-accent: #1c1c1c;

  /* Message bubbles */
  --chatui-bg-human: #1c1c1c;
  --chatui-fg-human: #ffffff;
  --chatui-bg-ai: #f5f5f4;
  --chatui-fg-ai: #1c1c1c;

  /* Chips */
  --chatui-chip-bg: #1c1c1c;
  --chatui-chip-fg: #ffffff;

  /* Buttons */
  --chatui-btn-bg: #1c1c1c;
  --chatui-btn-fg: #ffffff;
  --chatui-btn-hover: #333333;
  --chatui-btn-danger: #ef4444;

  /* Usage colors */
  --chatui-usage-input: #3b82f6;
  --chatui-usage-output: #8b5cf6;

  /* Think toggle */
  --chatui-think-fg: #7c3aed;
  --chatui-think-bg: rgba(124, 58, 237, 0.1);
  --chatui-think-border: rgba(124, 58, 237, 0.25);

  /* Tool approval */
  --chatui-approval-bg: #fffbeb;
  --chatui-approval-border: #fcd34d;

  /* Ask form */
  --chatui-ask-bg: #f0f9ff;
  --chatui-ask-border: #7dd3fc;

  /* Font */
  --chatui-font-family: inherit;
  --chatui-font-size: 14px;
  --chatui-font-size-sm: 12px;

  /* Spacing */
  --chatui-spacing-xs: 4px;
  --chatui-spacing-sm: 8px;
  --chatui-spacing-md: 16px;

  /* Radius */
  --chatui-radius-sm: 4px;
  --chatui-radius-md: 6px;
}
```

**Step 2: Create theme-web.css**

Website-specific overrides (mostly confirming defaults — the defaults ARE the web theme).

**Step 3: Create theme-vscode.css**

Map `--chatui-*` to `--vscode-*` variables:

```css
:root {
  --chatui-bg: var(--vscode-editor-background);
  --chatui-bg-surface: var(--vscode-editor-background);
  --chatui-bg-hover: var(--vscode-list-hoverBackground);
  --chatui-fg: var(--vscode-foreground);
  --chatui-fg-secondary: var(--vscode-descriptionForeground);
  --chatui-border: var(--vscode-widget-border, rgba(255,255,255,0.1));
  --chatui-btn-bg: var(--vscode-button-background);
  --chatui-btn-fg: var(--vscode-button-foreground);
  --chatui-btn-hover: var(--vscode-button-hoverBackground);
  /* ... etc ... */
}
```

**Step 4: Create theme-pwa.css**

Mobile-optimized spacing and sizing.

**Step 5: Update package.json exports**

Add to `packages/chat-ui/package.json`:

```json
"exports": {
  ".": "./src/index.ts",
  "./components/*": "./src/components/*",
  "./themes/*": "./src/themes/*"
}
```

**Step 6: Commit**

```
feat(chat-ui): add CSS theme system with web/vscode/pwa presets
```

---

## Task 14: Update index.ts exports

**Files:**
- Modify: `packages/chat-ui/src/index.ts`

**Step 1: Update exports**

Add all new component and type exports:

```typescript
// New types
export type {
  WikiOption, CreateSessionOpts, UsageInfo, UsageData,
  ToolCallEvent, ToolApprovalPayload,
  AskQuestionSpec, AskEvent, AskAnswerPayload,
  DisplayContent, DirEntry, DirListResult, QuickDir,
  AppSettings, SessionStatus, ChatEvent,
} from './types';

export { AskQuestionType, ToolApprovalType } from './types';

// New components
export { default as MultiSelect } from './components/MultiSelect.vue';
export { default as PathPickerModal } from './components/PathPickerModal.vue';
export { default as NewSessionModal } from './components/NewSessionModal.vue';
export { default as SessionBar } from './components/SessionBar.vue';
export { default as ConfigToolbar } from './components/ConfigToolbar.vue';
export { default as StatusBar } from './components/StatusBar.vue';
export { default as ChatArea } from './components/ChatArea.vue';
export { default as ToolApprovalBar } from './components/ToolApprovalBar.vue';
export { default as AskForm } from './components/AskForm.vue';
```

Keep existing exports for backward compat.

**Step 2: Commit**

```
feat(chat-ui): export all new components and types
```

---

## Task 15: Create WebSocketTransport for website

**Files:**
- Create: `packages/website/src/transport.ts`

**Step 1: Implement IChatTransport over WebSocket + REST**

Create `createWebSocketTransport()` that implements `IChatTransport`:

- `connect()` / `disconnect()` — manage WS connection to `/ws/chat`
- `onEvent()` / `offEvent()` — map WS messages to `ChatEvent` objects
- `listSessions()` — reads from local store (already loaded)
- `createSession()` — POST `/api/settings/sessions`
- `deleteSession()` — DELETE `/api/settings/sessions/{id}`
- `updateSession()` — PUT `/api/settings/sessions/{id}`
- `sendMessage()` — WS send `{ type: 'query', sessionId, parts, attachments }`
- `getHistory()` — GET `/api/sessions/{id}/history`
- `clearHistory()` — DELETE `/api/sessions/{id}/history`
- `getUsage()` — GET `/api/thread-usage?sessions={id}`
- `approveToolCall()` — WS send `{ type: 'approval', ... }`
- `answerAsk()` — WS send `{ type: 'ask', ... }`
- `abort()` — WS send `{ type: 'abort', ... }`
- `getSettings()` — GET `/api/settings`
- `getSessionStatus()` — GET `/api/session-status?sessionId={id}`
- `listDir()` — GET `/api/fs/list?dir={dir}`
- `quickDirs()` — GET `/api/fs/quickdirs`
- `mkdir()` — POST `/api/fs/mkdir`
- `getThinksUrlPrefix()` — returns `/api/sessions/{id}/thinks`
- `fetchThinks()` — GET via apiFetch

**Step 2: Commit**

```
feat(website): implement IChatTransport over WebSocket + REST
```

---

## Task 16: Migrate website ChatView to use chat-ui ChatView

**Files:**
- Modify: `packages/website/src/views/ChatView.vue` (major simplification)
- Possibly modify: `packages/website/src/router/index.ts`

**Step 1: Replace website ChatView**

Replace the 608-line ChatView with ~30 lines:

```vue
<template>
  <ChatView :transport="transport" :labels="labels" :show-attachments="true" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChatView } from '@sbot/chat-ui'
import '@sbot/chat-ui/themes/variables.css'
import '@sbot/chat-ui/themes/theme-web.css'
import { createWebSocketTransport } from '../transport'
import type { ChatLabels } from '@sbot/chat-ui'

const { t } = useI18n()
const transport = createWebSocketTransport()

const labels = computed<ChatLabels>(() => ({
  send: t('chat.send'),
  inputPlaceholder: t('chat.input_placeholder'),
  // ... map all i18n keys to ChatLabels ...
}))
</script>
```

**Step 2: Remove deprecated website components**

Delete (or keep for reference until fully verified):
- `packages/website/src/components/ChatArea.vue`
- `packages/website/src/components/ChatPanel.vue`
- `packages/website/src/components/MultiSelect.vue`
- `packages/website/src/views/modals/NewSessionModal.vue`
- `packages/website/src/views/modals/PathPickerModal.vue`
- `packages/website/src/composables/useChatViewLogic.ts`

**Step 3: Verify website works**

Run: `cd packages/website && pnpm dev`
Test: open in browser, verify all features work — session list, create session, switch, send message, token usage, refresh, clear history, tool approval, think drawer.

**Step 4: Commit**

```
refactor(website): migrate to unified ChatView from chat-ui
```

---

## Task 17: Migrate PWA to use chat-ui ChatView

**Files:**
- Modify: `packages/pwa/src/App.vue` (simplify)
- Create: `packages/pwa/src/transport.ts` (if not already using WebSocket transport)

**Step 1: Replace PWA chat implementation with ChatView**

Similar to website — import ChatView, create transport, done.

**Step 2: Verify PWA works**

Run: `cd packages/pwa && pnpm dev`
Test: all features.

**Step 3: Commit**

```
refactor(pwa): migrate to unified ChatView from chat-ui
```

---

## Task 18: Migrate VSCode extension to use chat-ui ChatView

**Files:**
- Modify: VSCode webview entry point
- Create: `packages/vscode-extension/src/webview/transport.ts` (VSCodeTransport implementing IChatTransport)

**Step 1: Implement VSCodeTransport**

Implements IChatTransport using `vscode.postMessage` / `window.addEventListener('message')` for the webview ↔ extension host bridge.

**Step 2: Replace webview chat UI with ChatView**

Import and render `<ChatView :transport="transport" />` with `theme-vscode.css`.

**Step 3: Verify**

Build extension, test in VSCode.

**Step 4: Commit**

```
refactor(vscode-extension): migrate to unified ChatView from chat-ui
```

---

## Task 19: Cleanup deprecated components

**Files:**
- Modify: `packages/chat-ui/src/index.ts`
- Possibly remove: `packages/chat-ui/src/components/SessionPicker.vue`

**Step 1: Remove deprecated exports**

Remove exports for: `ChatApp`, `SessionPicker` (if no longer referenced).
Keep: `ServerPicker` (still used by external callers).

**Step 2: Remove old useChat if no longer needed**

If ChatApp is removed and nothing references the old `useChat` composable, remove it from `transport.ts`.

**Step 3: Verify all packages build**

Run: `pnpm -r build` (or equivalent)

**Step 4: Commit**

```
chore(chat-ui): remove deprecated ChatApp, SessionPicker, old useChat
```
