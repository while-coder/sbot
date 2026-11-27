<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { SButton } from '@qingfeng346/ui-kit'

const props = withDefaults(defineProps<{ baseUrl?: string; locale?: string; managedToken?: string }>(), {
  baseUrl: '',
  locale: 'zh',
  managedToken: '',
})

const zh = {
  title: '功能循环', token: '访问令牌', connect: '连接', refresh: '刷新', create: '新建循环',
  enabled: '使用启动 sbot 时设置的 SBOT_FEATURE_LOOP_TOKEN。',
  unavailable: '当前服务未开启功能循环。请设置 SBOT_FEATURE_LOOP_TOKEN 后重启 sbot。',
  copyToken: '复制访问令牌', copied: '已复制令牌', empty: '还没有功能循环。新建一个循环开始运行。',
  repository: 'Git 项目路径', goal: '目标', saver: '历史存储', limit: '功能数量上限',
  limitHelp: '留空时持续运行。首次可以先运行一个功能。', roles: '角色与工具',
  planner: '选题', product: '产品', engineering: '技术', qa: 'QA',
  tools: '工具名，以逗号分隔', prereqs: '请先在 sbot 中配置 Single 模式的 Agent 和历史存储。',
  choose: '请选择', cancel: '取消', start: '创建并启动', pause: '暂停', resume: '继续原阶段',
  edit: '编辑文档', resumeSpec: '按当前文档继续', apply: '保存并从技术阶段继续',
  spec: '产品文档', worktree: '工作目录', branch: '分支', commit: '最近提交',
  completed: '已完成功能', running: '运行中', queued: '等待执行', stopping: '暂停中', paused: '已暂停',
  complete: '已完成', prepare: '准备工作目录', select: '选功能', implement: '实现', review: '验收',
  committing: '提交', report: 'QA 报告', pass: '通过', product_issue: '产品问题',
  implementation_issue: '实现问题', blocked: '无法验收', loading: '加载中…',
}
const en: typeof zh = {
  title: 'Feature Loops', token: 'Access token', connect: 'Connect', refresh: 'Refresh', create: 'New loop',
  enabled: 'Use the SBOT_FEATURE_LOOP_TOKEN set when starting sbot.',
  unavailable: 'Feature Loops are disabled on this server. Set SBOT_FEATURE_LOOP_TOKEN and restart sbot.',
  copyToken: 'Copy access token', copied: 'Token copied', empty: 'No feature loops yet. Create one to get started.',
  repository: 'Git project path', goal: 'Goal', saver: 'History saver', limit: 'Feature limit',
  limitHelp: 'Leave blank to keep running. Start with one feature to try it out.', roles: 'Roles and tools',
  planner: 'Planner', product: 'Product', engineering: 'Engineering', qa: 'QA',
  tools: 'Tool names, separated by commas', prereqs: 'Configure a Single-mode agent and a history saver in sbot first.',
  choose: 'Select…', cancel: 'Cancel', start: 'Create and start', pause: 'Pause', resume: 'Resume stage',
  edit: 'Edit spec', resumeSpec: 'Resume from current spec', apply: 'Save and resume implementation',
  spec: 'Product spec', worktree: 'Worktree', branch: 'Branch', commit: 'Latest commit',
  completed: 'Features completed', running: 'Running', queued: 'Queued', stopping: 'Pausing', paused: 'Paused',
  complete: 'Complete', prepare: 'Prepare worktree', select: 'Select feature', implement: 'Implement', review: 'Review',
  committing: 'Commit', report: 'QA report', pass: 'Passed', product_issue: 'Product issue',
  implementation_issue: 'Implementation issue', blocked: 'Blocked', loading: 'Loading…',
}
const s = computed(() => props.locale.toLowerCase().startsWith('zh') ? zh : en)

const roles = ['planner', 'product', 'engineering', 'qa'] as const
type Role = typeof roles[number]
type Stage = 'prepare' | 'select' | 'product' | 'implement' | 'qa' | 'commit' | 'complete'
type Review = { summary: string; verdict?: 'pass' | 'product_issue' | 'implementation_issue' | 'blocked'; evidence?: string[] }
type Loop = {
  id: string; repository: string; goal: string; stage: Stage; running: boolean; paused: boolean
  completed: number; maxFeatures?: number; worktree: string; branch: string; lastError?: string; lastCommit?: string
  feature?: { title: string; specPath: string; specHash?: string; review?: Review }
  lastFeature?: { title: string; specPath: string; review?: Review }
}
type Spec = { text: string; hash: string; path: string }
type Settings = { agents?: Record<string, { name?: string; type?: string }>; savers?: Record<string, { name?: string }> }

const defaultTools: Record<Role, string> = {
  planner: 'exec_command', product: 'exec_command',
  engineering: 'exec_command, apply_patch, view_image', qa: 'exec_command, view_image',
}
const form = ref({
  repository: '', goal: '', saverId: '', limit: '1',
  agents: { planner: '', product: '', engineering: '', qa: '' },
  tools: { ...defaultTools },
})
const settings = ref<Settings>({})
const agents = computed(() => Object.entries(settings.value.agents ?? {}).filter(([, agent]) => agent.type === 'single'))
const savers = computed(() => Object.entries(settings.value.savers ?? {}))

const loops = ref<Loop[]>([])
const selected = ref('')
const current = computed(() => loops.value.find(loop => loop.id === selected.value))
const editable = computed(() => Boolean(current.value?.paused && !current.value.running && current.value.feature?.specHash))
const review = computed(() => current.value?.feature?.review ?? (!current.value?.feature ? current.value?.lastFeature?.review : undefined))
const tokenInput = ref('')
const token = ref('')
const authorized = ref(false)
const loading = ref(false)
const busy = ref(false)
const creating = ref(false)
const editor = ref<(Spec & { id: string })>()
const error = ref('')
const notice = ref('')
let generation = 0

const storageKey = computed(() => `sbot.feature-loop.token:${props.baseUrl || location.origin}`)
const detailUrl = (id: string) => `/api/feature-loops/${encodeURIComponent(id)}`

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${props.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token.value}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json().catch(() => undefined)
  if (!response.ok || !result?.success) {
    throw new RequestError(result?.message || `HTTP ${response.status}`, response.status)
  }
  return result.data as T
}

function showError(cause: unknown) {
  if (cause instanceof RequestError && cause.status === 401) {
    authorized.value = false
    if (!props.managedToken) sessionStorage.removeItem(storageKey.value)
  }
  error.value = cause instanceof RequestError && cause.status === 404 && !authorized.value
    ? s.value.unavailable : cause instanceof Error ? cause.message : String(cause)
}

async function refresh() {
  if (!token.value || loading.value || busy.value) return
  const version = generation
  loading.value = true
  try {
    const result = await request<Loop[]>('/api/feature-loops')
    if (version !== generation) return
    if (!authorized.value) error.value = ''
    authorized.value = true
    loops.value = result
    if (!result.some(loop => loop.id === selected.value)) selected.value = result[0]?.id ?? ''
  } catch (cause) {
    if (version === generation) showError(cause)
  } finally {
    if (version === generation) loading.value = false
  }
}

function resetConnection(value: string) {
  generation++
  token.value = value.trim()
  authorized.value = false
  loading.value = false
  busy.value = false
  creating.value = false
  editor.value = undefined
  loops.value = []
  selected.value = ''
  error.value = ''
  notice.value = ''
  void refresh()
}

watch(() => [props.baseUrl, props.managedToken], () => {
  tokenInput.value = props.managedToken || sessionStorage.getItem(storageKey.value) || ''
  resetConnection(tokenInput.value)
}, { immediate: true })

watch(authorized, value => {
  if (value && !props.managedToken) sessionStorage.setItem(storageKey.value, token.value)
})

const refreshTimer = setInterval(() => {
  if (authorized.value && !document.hidden) void refresh()
}, 2500)
onUnmounted(() => { generation++; clearInterval(refreshTimer) })

async function perform(action: (stillCurrent: () => boolean) => Promise<void>) {
  if (busy.value) return
  const version = ++generation
  loading.value = false
  busy.value = true
  error.value = ''
  notice.value = ''
  try { await action(() => version === generation) } catch (cause) {
    if (version === generation) showError(cause)
  } finally {
    if (version === generation) busy.value = false
  }
}

async function openCreate() {
  await perform(async live => {
    const result = await request<Settings>('/api/settings')
    if (!live()) return
    settings.value = result
    if (!savers.value.some(([id]) => id === form.value.saverId)) form.value.saverId = savers.value[0]?.[0] ?? ''
    if (agents.value.length === 1) {
      for (const role of roles) form.value.agents[role] = agents.value[0]![0]
    }
    creating.value = true
    editor.value = undefined
  })
}

function update(result: Loop) {
  loops.value = [result, ...loops.value.filter(loop => loop.id !== result.id)]
  selected.value = result.id
}

async function create() {
  await perform(async live => {
    const result = await request<Loop>('/api/feature-loops', 'POST', {
      repository: form.value.repository.trim(), goal: form.value.goal.trim(), saverId: form.value.saverId,
      maxFeatures: form.value.limit === '' ? undefined : Number(form.value.limit),
      roles: Object.fromEntries(roles.map(role => [role, {
        agentId: form.value.agents[role],
        tools: form.value.tools[role].split(/[,，\n]/).map(name => name.trim()).filter(Boolean),
      }])),
    })
    if (!live()) return
    update(result)
    creating.value = false
  })
}

async function act(action: 'pause' | 'resume', useCurrentSpec = false, spec?: Spec & { id: string }) {
  const id = spec?.id ?? current.value?.id
  if (!id) return
  await perform(async live => {
    const result = await request<Loop>(`${detailUrl(id)}/${action}`, 'POST', {
      useCurrentSpec, spec: spec && { text: spec.text, hash: spec.hash },
    })
    if (!live()) return
    update(result)
    editor.value = undefined
  })
}

async function openSpec(id: string) {
  await perform(async live => {
    const spec = await request<Spec>(`${detailUrl(id)}/spec`)
    if (live()) editor.value = { ...spec, id }
  })
}

async function copyToken() {
  await perform(async live => {
    await navigator.clipboard.writeText(props.managedToken.trim())
    if (live()) notice.value = s.value.copied
  })
}

function status(loop: Loop): string {
  if (loop.stage === 'complete') return s.value.complete
  if (loop.paused) return loop.running ? s.value.stopping : s.value.paused
  return loop.running ? s.value.running : s.value.queued
}

const stageNames = computed<Record<Stage, string>>(() => ({
  prepare: s.value.prepare, select: s.value.select, product: s.value.product,
  implement: s.value.implement, qa: s.value.review, commit: s.value.committing, complete: s.value.complete,
}))
</script>

<template>
  <section class="feature-loops" :aria-label="s.title">
    <div class="loop-toolbar">
      <h2>{{ s.title }}</h2>
      <div v-if="authorized" class="loop-actions">
        <SButton :disabled="loading || busy" @click="refresh">{{ s.refresh }}</SButton>
        <SButton type="primary" :disabled="busy || creating || !!editor" @click="openCreate">{{ s.create }}</SButton>
      </div>
    </div>

    <p v-if="error" class="loop-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="loop-muted" role="status">{{ notice }}</p>

    <form v-if="!authorized && (!managedToken || !loading)" class="loop-card loop-form" @submit.prevent="resetConnection(tokenInput)">
      <label>{{ s.token }} <input v-model="tokenInput" type="password" autocomplete="off" required /></label>
      <p class="loop-muted">{{ s.enabled }}</p>
      <div><button type="submit" :disabled="loading">{{ s.connect }}</button></div>
    </form>
    <p v-else-if="!authorized" class="loop-muted" role="status">{{ s.loading }}</p>

    <template v-else>
      <form v-if="creating" class="loop-card loop-form" @submit.prevent="create">
        <div class="loop-fields">
          <label>{{ s.repository }} <input v-model="form.repository" required /></label>
          <label>{{ s.saver }}
            <select v-model="form.saverId" required>
              <option value="" disabled>{{ s.choose }}</option>
              <option v-for="[id, saver] in savers" :key="id" :value="id">{{ saver.name || id }}</option>
            </select>
          </label>
          <label>{{ s.limit }} <input v-model="form.limit" type="number" min="1" step="1" /><small>{{ s.limitHelp }}</small></label>
        </div>
        <label>{{ s.goal }} <textarea v-model="form.goal" rows="3" maxlength="8000" required /></label>
        <fieldset>
          <legend>{{ s.roles }}</legend>
          <div class="loop-fields">
            <div v-for="role in roles" :key="role" class="loop-role">
              <label>{{ s[role] }}
                <select v-model="form.agents[role]" required>
                  <option value="" disabled>{{ s.choose }}</option>
                  <option v-for="[id, agent] in agents" :key="id" :value="id">{{ agent.name || id }}</option>
                </select>
              </label>
              <label>{{ s.tools }} <input v-model="form.tools[role]" /></label>
            </div>
          </div>
        </fieldset>
        <p v-if="!agents.length || !savers.length" class="loop-muted">{{ s.prereqs }}</p>
        <div class="loop-actions">
          <button type="submit" :disabled="busy || !agents.length || !savers.length">{{ s.start }}</button>
          <SButton :disabled="busy" @click="creating = false">{{ s.cancel }}</SButton>
        </div>
      </form>

      <p v-if="!loops.length && !creating" class="loop-card loop-muted">{{ s.empty }}</p>
      <div v-if="loops.length" class="loop-layout">
        <div class="loop-list">
          <button v-for="loop in loops" :key="loop.id" type="button" class="loop-list-item"
            :aria-pressed="selected === loop.id" :disabled="busy || !!editor" @click="selected = loop.id">
            <strong>{{ loop.feature?.title || loop.lastFeature?.title || loop.goal }}</strong>
            <span>{{ status(loop) }} · {{ stageNames[loop.stage] }}</span>
          </button>
        </div>
        <div v-if="current" class="loop-card loop-detail">
          <div class="loop-actions">
            <strong>{{ status(current) }} · {{ stageNames[current.stage] }}</strong>
            <span>{{ s.completed }} {{ current.completed }}{{ current.maxFeatures ? ` / ${current.maxFeatures}` : '' }}</span>
          </div>
          <p>{{ current.goal }}</p>
          <dl>
            <dt>{{ s.repository }}</dt><dd><code>{{ current.repository }}</code></dd>
            <dt>{{ s.worktree }}</dt><dd><code>{{ current.worktree }}</code></dd>
            <dt>{{ s.branch }}</dt><dd><code>{{ current.branch }}</code></dd>
            <template v-if="current.feature || current.lastFeature">
              <dt>{{ s.spec }}</dt><dd><code>{{ (current.feature || current.lastFeature)?.specPath }}</code></dd>
            </template>
            <template v-if="current.lastCommit">
              <dt>{{ s.commit }}</dt><dd><code>{{ current.lastCommit }}</code></dd>
            </template>
          </dl>
          <p v-if="current.lastError" class="loop-error" role="status">{{ current.lastError }}</p>
          <details v-if="review">
            <summary>{{ s.report }}{{ review.verdict ? ` · ${s[review.verdict]}` : '' }}</summary>
            <p>{{ review.summary }}</p>
            <ul v-if="review.evidence?.length"><li v-for="(item, index) in review.evidence" :key="index">{{ item }}</li></ul>
          </details>
          <form v-if="editor" class="loop-form" @submit.prevent="act('resume', true, editor)">
            <label>{{ s.spec }} <textarea v-model="editor.text" rows="12" maxlength="60000" required spellcheck="false" /></label>
            <div class="loop-actions">
              <button type="submit" :disabled="busy || !editor.text.trim()">{{ s.apply }}</button>
              <SButton :disabled="busy" @click="editor = undefined">{{ s.cancel }}</SButton>
            </div>
          </form>
          <div v-else-if="current.stage !== 'complete'" class="loop-actions">
            <SButton v-if="!current.paused" :disabled="busy" @click="act('pause')">{{ s.pause }}</SButton>
            <template v-else>
              <SButton :disabled="busy || current.running" @click="act('resume')">{{ s.resume }}</SButton>
              <template v-if="editable">
                <SButton :disabled="busy || creating" @click="openSpec(current.id)">{{ s.edit }}</SButton>
                <SButton :disabled="busy" @click="act('resume', true)">{{ s.resumeSpec }}</SButton>
              </template>
            </template>
          </div>
        </div>
      </div>
      <div v-if="managedToken">
        <SButton :disabled="busy" @click="copyToken">{{ s.copyToken }}</SButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.feature-loops { display: grid; gap: 16px; padding: 16px 24px 24px; color: var(--sui-fg); overflow-wrap: anywhere; }
.loop-toolbar, .loop-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.loop-toolbar { justify-content: space-between; }
.loop-toolbar h2 { margin: 0; font-size: 18px; }
.loop-layout { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(0, 2fr); gap: 16px; align-items: start; }
.loop-card { border: 1px solid var(--sui-border); border-radius: 8px; padding: 16px; margin: 0; }
.loop-detail, .loop-list, .loop-form, .loop-role { display: grid; gap: 12px; }
.loop-detail > p, .loop-muted, .loop-error, dd { margin: 0; }
.loop-muted, small, .loop-list-item span { color: var(--sui-fg-muted); }
.loop-error { color: var(--sui-error, #c93636); white-space: pre-wrap; }
.loop-list-item { display: grid; gap: 6px; text-align: start; padding: 12px; border: 1px solid var(--sui-border); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
.loop-list-item[aria-pressed="true"] { background: var(--sui-bg-active); border-color: var(--sui-primary); }
.loop-list-item:not(:disabled):hover { background: var(--sui-bg-hover); }
.loop-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 12px; }
.loop-form label { min-width: 0; display: grid; gap: 5px; font-size: 13px; }
.loop-form :is(input, select, textarea) { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--sui-border); border-radius: 6px; padding: 8px; background: var(--sui-bg); color: inherit; font: inherit; }
.loop-form textarea { resize: vertical; }
.loop-form fieldset { min-width: 0; border: 1px solid var(--sui-border); border-radius: 6px; padding: 12px; }
.loop-form button[type="submit"] { padding: 8px 14px; border: 1px solid var(--sui-fg); border-radius: 6px; background: var(--sui-fg); color: var(--sui-bg); font: inherit; cursor: pointer; }
.loop-form button[type="submit"]:disabled { opacity: .5; cursor: default; }
.loop-detail dl { display: grid; grid-template-columns: minmax(80px, max-content) minmax(0, 1fr); gap: 6px 12px; margin: 0; }
.loop-detail dt { color: var(--sui-fg-muted); }
.loop-detail summary { cursor: pointer; }
.feature-loops :is(button, input, select, textarea):focus-visible { outline: 2px solid var(--sui-primary, #2671d9); outline-offset: 2px; }
@media (max-width: 680px) {
  .feature-loops { padding: 12px; }
  .loop-layout { grid-template-columns: minmax(0, 1fr); }
}
</style>
