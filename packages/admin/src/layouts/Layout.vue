<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { store, applyMcpList } from '@/shared/store'
import { useToast } from 'sbot-ui'
import { fetchLatestRelease, compareSemver, GITHUB_REPO_URL, GITHUB_RELEASES_URL } from 'sbot.commons'
import { useResponsive } from '../composables/useResponsive'
import { saveLocale } from '@/i18n'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const { show } = useToast()
const { isMobile } = useResponsive()
const sidebarOpen = ref(false)

// Desktop sidebar: collapse + resize (persisted to localStorage)
const SIDEBAR_MIN = 140
const SIDEBAR_MAX = 360
const SIDEBAR_DEFAULT = 168
const sidebarCollapsed = ref(localStorage.getItem('sbot-sidebar-collapsed') === '1')
const sidebarWidth = ref((() => {
  const v = parseInt(localStorage.getItem('sbot-sidebar-width') || '', 10)
  if (Number.isFinite(v) && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX) return v
  return SIDEBAR_DEFAULT
})())
const sidebarStyle = computed(() => isMobile.value ? {} : { width: `${sidebarWidth.value}px` })

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('sbot-sidebar-collapsed', sidebarCollapsed.value ? '1' : '0')
}

let resizing = false
function onResizeStart(e: MouseEvent) {
  if (isMobile.value || sidebarCollapsed.value) return
  e.preventDefault()
  resizing = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}
function onResizeMove(e: MouseEvent) {
  if (!resizing) return
  const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX))
  sidebarWidth.value = w
}
function onResizeEnd() {
  if (!resizing) return
  resizing = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  localStorage.setItem('sbot-sidebar-width', String(sidebarWidth.value))
}

const menuGroups = computed(() => [
  {
    group: t('nav.chat'),
    items: [
      { label: t('nav.chat'), key: '/chat' },
      { label: t('nav.channels'), key: '/channels' },
      { label: t('nav.session_profiles'), key: '/session-profiles' },
    ],
  },
  {
    group: t('nav.group_basics'),
    items: [
      { label: t('nav.settings'), key: '/settings' },
    ],
  },
  {
    group: t('nav.group_models'),
    items: [
      { label: t('nav.models'), key: '/models' },
      { label: t('nav.embeddings'), key: '/embeddings' },
    ],
  },
  {
    group: t('nav.group_agents'),
    items: [
      { label: t('nav.agents'), key: '/agents' },
      { label: t('nav.agent_store'), key: '/agent-store' },
    ],
  },
  {
    group: t('nav.group_storage'),
    items: [
      { label: t('nav.savers'), key: '/savers' },
      { label: t('nav.memories'), key: '/memories' },
      { label: t('nav.wikis'), key: '/wikis' },
    ],
  },
  {
    group: t('nav.group_tools'),
    items: [
      { label: t('nav.mcp'), key: '/mcp' },
      { label: t('nav.skills'), key: '/skills' },
      { label: t('nav.prompts'), key: '/prompts' },
    ],
  },
  {
    group: t('nav.group_monitor'),
    items: [
      { label: t('nav.processes'), key: '/processes' },
      { label: t('nav.heartbeats'), key: '/heartbeats' },
      { label: t('nav.token_usage'), key: '/token-usage' },
    ],
  },
  {
    group: t('nav.group_tasks'),
    items: [
      { label: t('nav.scheduler'), key: '/scheduler' },
      { label: t('nav.todo'), key: '/todo' },
    ],
  },
  {
    group: t('nav.group_system'),
    items: [
      { label: t('nav.explorer'), key: '/explorer' },
      { label: t('nav.logs'), key: '/logs' },
      { label: t('nav.about'), key: '/about' },
    ],
  },
])

const activeKey = computed(() => {
  const p = route.path
  if (p.startsWith('/agents/')) return '/agents'
if (p.startsWith('/savers/') && p.endsWith('/view')) return '/savers'
  if (p.startsWith('/memories/') && p.endsWith('/view')) return '/memories'
  return p
})

async function reloadConfig() {
  try {
    await apiFetch('/api/reload', 'POST')
    const res = await apiFetch('/api/settings')
    Object.assign(store.settings, res.data)
    const mcpRes = await apiFetch('/api/mcp')
    applyMcpList(mcpRes.data || [])
    show(t('nav.reload_success'))
  } catch (e: any) {
    show(e.message, 'error')
  }
}


const hasUpdate = ref(false)

// Language switcher
const showLangMenu = ref(false)
const languages = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
]
function switchLocale(code: string) {
  locale.value = code
  saveLocale(code)
  showLangMenu.value = false
}

// Theme switcher
type ThemeMode = 'light' | 'dark' | 'system'
const showThemeMenu = ref(false)
const currentTheme = ref<ThemeMode>((localStorage.getItem('sbot-theme') as ThemeMode) || 'system')

function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
}

function switchTheme(mode: ThemeMode) {
  currentTheme.value = mode
  localStorage.setItem('sbot-theme', mode)
  applyTheme(mode)
  showThemeMenu.value = false
}

applyTheme(currentTheme.value)
const systemMql = window.matchMedia('(prefers-color-scheme: dark)')
function onSystemThemeChange() {
  if (currentTheme.value === 'system') applyTheme('system')
}

// Docs URL
const docsUrl = computed(() => locale.value === 'zh'
  ? `${GITHUB_REPO_URL}/blob/main/README.zh.md`
  : `${GITHUB_REPO_URL}/blob/main/README.md`)

async function checkUpdate(currentVersion: string) {
  const data = await fetchLatestRelease()
  if (!data) return
  const latest = data.tag || ''
  if (latest && compareSemver(currentVersion, latest) < 0) hasUpdate.value = true
}

// Initial load
async function init() {
  try {
    const [settingsRes, mcpRes, skillRes, aboutRes, sessionsRes] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/mcp'),
      apiFetch('/api/skills'),
      apiFetch('/api/about'),
      apiFetch('/api/profiles'),
    ])
    Object.assign(store.settings, settingsRes.data)
    // Convert sessions array to Record<id, SessionConfig>
    const sessionsArr: any[] = sessionsRes.data || []
    const sessionsMap: Record<string, any> = {}
    for (const s of sessionsArr) {
      const { id, ...rest } = s
      sessionsMap[id] = rest
    }
    store.sessions = sessionsMap
    applyMcpList(mcpRes.data || [])
    const allSkillsData = skillRes.data || []
    store.allSkills = allSkillsData
    if (aboutRes.data?.version) checkUpdate(aboutRes.data.version)
  } catch (_) {}
}

init()

function closeDropdowns(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (showLangMenu.value && !target?.closest('.lang-btn')) showLangMenu.value = false
  if (showThemeMenu.value && !target?.closest('.theme-btn')) showThemeMenu.value = false
}
onMounted(() => {
  document.addEventListener('click', closeDropdowns)
  systemMql.addEventListener('change', onSystemThemeChange)
})
onUnmounted(() => {
  document.removeEventListener('click', closeDropdowns)
  systemMql.removeEventListener('change', onSystemThemeChange)
})
</script>

<template>
  <div class="app-layout">
    <div class="topbar">
      <div class="topbar-left">
        <button v-if="isMobile" class="hamburger-btn" @click="sidebarOpen = !sidebarOpen">&#9776;</button>
        <button
          v-else
          class="sidebar-toggle-btn"
          :title="sidebarCollapsed ? t('nav.sidebar_expand') : t('nav.sidebar_collapse')"
          @click="toggleSidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>
        </button>
        <div class="topbar-title">{{ t('nav.app_title') }}</div>
      </div>
      <div class="topbar-right">
        <nav class="topbar-nav">
          <a :href="GITHUB_RELEASES_URL" target="_blank" class="topbar-link">{{ t('nav.changelog') }}</a>
          <a :href="docsUrl" target="_blank" class="topbar-link">{{ t('nav.docs') }}</a>
          <a :href="`${GITHUB_REPO_URL}/issues`" target="_blank" class="topbar-link">{{ t('nav.faq') }}</a>
          <a :href="GITHUB_REPO_URL" target="_blank" class="topbar-link">GitHub</a>
        </nav>
        <div class="topbar-icon-btn lang-btn" style="position:relative" @click="showLangMenu = !showLangMenu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <div v-if="showLangMenu" class="lang-dropdown">
            <div v-for="lang in languages" :key="lang.code" class="lang-option" :class="{ active: locale === lang.code }" @click.stop="switchLocale(lang.code)">{{ lang.label }}</div>
          </div>
        </div>
        <div class="topbar-icon-btn theme-btn" style="position:relative" @click="showThemeMenu = !showThemeMenu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <div v-if="showThemeMenu" class="theme-dropdown">
            <div class="theme-option" :class="{ active: currentTheme === 'light' }" @click.stop="switchTheme('light')">{{ t('nav.theme_light') }}</div>
            <div class="theme-option" :class="{ active: currentTheme === 'dark' }" @click.stop="switchTheme('dark')">{{ t('nav.theme_dark') }}</div>
            <div class="theme-option" :class="{ active: currentTheme === 'system' }" @click.stop="switchTheme('system')">{{ t('nav.theme_system') }}</div>
          </div>
        </div>
        <div class="topbar-icon-btn" @click="reloadConfig" :title="t('nav.reload')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </div>
      </div>
    </div>
    <div class="app-body">
      <div v-if="isMobile && sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
      <div
        v-show="isMobile || !sidebarCollapsed"
        class="sidebar"
        :class="{ 'sidebar-open': sidebarOpen, 'sidebar-mobile': isMobile }"
        :style="sidebarStyle"
      >
        <template v-for="group in menuGroups" :key="group.group">
          <div class="sidebar-group-label">{{ group.group }}</div>
          <div
            v-for="item in group.items"
            :key="item.key"
            class="sidebar-item"
            :class="{ active: activeKey === item.key }"
            @click="router.push(item.key); isMobile && (sidebarOpen = false)"
          >
            {{ item.label }}
            <span v-if="item.key === '/about' && hasUpdate" class="update-dot"></span>
          </div>
        </template>
        <div v-if="!isMobile" class="sidebar-resize-handle" @mousedown="onResizeStart"></div>
      </div>
      <div class="main-content">
        <RouterView />
      </div>
    </div>

  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { height: 100%; }
body {
  font-family: var(--sui-font);
  font-size: var(--sui-fs-lg);
  color: var(--sui-fg);
  background: var(--sui-bg-page);
}

/* ===== Layout shell ===== */
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sui-sp-8);
  height: 52px;
  border-bottom: 1px solid var(--sui-border);
  background: var(--sui-bg-page);
  flex-shrink: 0;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-3);
}
.topbar-nav {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-1);
}
.topbar-link {
  padding: var(--sui-sp-1) var(--sui-sp-5);
  font-size: var(--sui-fs-md);
  font-weight: 500;
  color: var(--sui-fg-secondary);
  text-decoration: none;
  border-radius: 5px;
  transition: background var(--sui-transition-base), color var(--sui-transition-base);
}
.topbar-link:hover {
  background: var(--sui-bg-soft);
  color: var(--sui-fg);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
}
.topbar-icon-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--sui-radius-md);
  cursor: pointer;
  color: var(--sui-fg-muted);
  transition: background var(--sui-transition-base), color var(--sui-transition-base);
}
.topbar-icon-btn:hover {
  background: var(--sui-bg-soft);
  color: var(--sui-fg);
}
.topbar-title {
  font-size: var(--sui-fs-2xl);
  font-weight: 700;
  color: var(--sui-fg);
}
.lang-dropdown,
.theme-dropdown {
  position: absolute;
  top: 38px;
  right: 0;
  background: var(--sui-bg);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  box-shadow: var(--sui-shadow-md);
  padding: var(--sui-sp-1);
  z-index: var(--sui-z-dropdown);
}
.lang-dropdown { min-width: 150px; }
.theme-dropdown { min-width: 120px; }
.lang-option,
.theme-option {
  padding: var(--sui-sp-3) var(--sui-sp-6);
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-secondary);
  border-radius: 5px;
  cursor: pointer;
  transition: background var(--sui-transition-fast);
}
.lang-option:hover,
.theme-option:hover { background: var(--sui-bg-soft); }
.lang-option.active,
.theme-option.active { font-weight: 600; color: var(--sui-fg); }

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.sidebar {
  width: 168px;
  border-right: 1px solid var(--sui-border);
  background: var(--sui-bg-page);
  padding: var(--sui-sp-3);
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}
.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background var(--sui-transition-fast);
}
.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: var(--sui-primary);
  opacity: 0.4;
}
.sidebar-toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--sui-sp-2);
  border-radius: var(--sui-radius-md);
  color: var(--sui-fg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--sui-transition-base), color var(--sui-transition-base);
}
.sidebar-toggle-btn:hover {
  background: var(--sui-bg-soft);
  color: var(--sui-fg);
}
.sidebar-group-label {
  padding: var(--sui-sp-7) var(--sui-sp-3) 5px;
  font-size: var(--sui-fs-sm);
  font-weight: 700;
  color: var(--sui-fg-secondary);
  user-select: none;
  border-top: 1px solid var(--sui-border);
  margin-top: var(--sui-sp-1);
}
.sidebar-group-label:first-of-type {
  padding-top: var(--sui-sp-2);
  border-top: none;
  margin-top: 0;
}
.sidebar-item {
  padding: var(--sui-sp-3) var(--sui-sp-5);
  font-size: var(--sui-fs-md);
  color: var(--sui-fg-muted);
  cursor: pointer;
  transition: background var(--sui-transition-fast), color var(--sui-transition-fast);
  border-radius: var(--sui-radius-md);
  user-select: none;
  display: flex;
  align-items: center;
  gap: var(--sui-sp-2);
}
.sidebar-item:hover { background: var(--sui-bg-soft); color: var(--sui-fg); }
.sidebar-item.active { background: var(--sui-bg-subtle); color: var(--sui-fg); font-weight: 600; }
.update-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sui-danger);
  flex-shrink: 0;
  margin-left: auto;
}
.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ===== Tables (used by view-level data tables) ===== */
table { width: 100%; border-collapse: collapse; font-size: var(--sui-fs-md); }
table th, table td {
  padding: var(--sui-sp-4) var(--sui-sp-5);
  text-align: left;
  border-bottom: 1px solid var(--sui-border);
}
table th {
  font-weight: 600;
  color: var(--sui-fg-muted);
  background: var(--sui-bg-subtle);
  font-size: var(--sui-fs-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
table tr:hover td { background: var(--sui-bg-subtle); }
.ops-cell { display: inline-flex; gap: var(--sui-sp-2); align-items: center; white-space: nowrap; }

/* ===== Check items (used by McpView) ===== */
.check-row { display: flex; flex-wrap: wrap; gap: var(--sui-sp-3); }
.check-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: var(--sui-sp-1) var(--sui-sp-4);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  cursor: pointer;
  font-size: var(--sui-fs-md);
  background: var(--sui-bg-subtle);
  user-select: none;
}
.check-item:hover { background: var(--sui-bg-hover); }
.check-item input[type=checkbox] { cursor: pointer; }

/* ===== MCP Tools Viewer (used by McpToolsModal + mcpSchema.ts v-html) ===== */
.tools-loading { text-align: center; color: var(--sui-fg-disabled); padding: 40px 0; font-size: var(--sui-fs-lg); }
.tools-count { font-size: var(--sui-fs-sm); color: var(--sui-fg-disabled); font-weight: 400; margin-left: var(--sui-sp-3); }
.tools-list { list-style: none; margin: 0; padding: 0; }
.tools-list li { padding: var(--sui-sp-5) var(--sui-sp-8); border-bottom: 1px solid var(--sui-border); }
.tools-list li:last-child { border-bottom: none; }
.tools-list li:hover { background: var(--sui-bg-subtle); }
.tool-header { display: flex; align-items: center; gap: var(--sui-sp-3); }
.tool-header .tool-name { flex: 1; }
.tool-name { font-size: var(--sui-fs-md); font-weight: 600; color: var(--sui-fg); font-family: var(--sui-font-mono); cursor: pointer; user-select: none; }
.tool-name::before { content: '\25B6'; font-size: 9px; margin-right: var(--sui-sp-2); color: var(--sui-fg-disabled); display: inline-block; transition: transform var(--sui-transition-base); }
.tool-name.expanded::before { transform: rotate(90deg); }
.tools-approve-bar { display: flex; align-items: center; gap: var(--sui-sp-4); padding: var(--sui-sp-3) var(--sui-sp-8); border-bottom: 1px solid var(--sui-border); background: var(--sui-bg-subtle); }
.tools-approve-label { font-size: var(--sui-fs-sm); color: var(--sui-fg-muted); flex: 1; }
.auto-approve-switch { display: flex; align-items: center; gap: var(--sui-sp-2); cursor: pointer; flex-shrink: 0; }
.auto-approve-switch input[type=checkbox] { display: none; }
.switch-track { position: relative; display: inline-block; width: 28px; height: 16px; border-radius: var(--sui-radius-lg); background: var(--sui-neutral-mid); transition: background var(--sui-transition-slow); flex-shrink: 0; }
.switch-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--sui-bg); transition: transform var(--sui-transition-slow); }
.auto-approve-switch input:checked + .switch-track { background: var(--sui-primary); }
.auto-approve-switch input:checked + .switch-track::after { transform: translateX(12px); }
.switch-label { font-size: var(--sui-fs-xs); color: var(--sui-fg-disabled); white-space: nowrap; }
.tool-desc { font-size: var(--sui-fs-sm); color: var(--sui-fg-muted); margin-top: 3px; line-height: 1.5; }
.tool-params { display: none; margin-top: var(--sui-sp-3); border-left: 2px solid var(--sui-border); padding-left: var(--sui-sp-5); }
.tool-params.show { display: block; }
.tool-param { padding: 5px 0; font-size: var(--sui-fs-sm); line-height: 1.5; }
.tool-param + .tool-param { border-top: 1px solid var(--sui-bg-soft); }
.param-name { font-family: var(--sui-font-mono); font-weight: 600; color: var(--sui-fg); }
.param-type { color: var(--sui-violet); font-size: var(--sui-fs-xs); margin-left: var(--sui-sp-1); }
.param-required { color: var(--sui-danger); font-size: var(--sui-fs-xxs); font-weight: 600; margin-left: var(--sui-sp-1); }
.param-desc { color: var(--sui-fg-muted); margin-top: 1px; }
.param-enum { color: var(--sui-cyan); font-size: var(--sui-fs-xs); font-family: var(--sui-font-mono); }
.param-default { color: var(--sui-fg-disabled); font-size: var(--sui-fs-xs); }
.tool-no-params { font-size: var(--sui-fs-sm); color: var(--sui-fg-disabled); font-style: italic; padding: var(--sui-sp-1) 0; }

/* ===== Sub-agent (used by AgentModal/AgentsView) ===== */
.sub-agent-item {
  padding: var(--sui-sp-3) var(--sui-sp-5);
  margin-bottom: var(--sui-sp-3);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-md);
  background: var(--sui-bg-subtle);
}
.sub-agent-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sub-agent-item-name { font-size: var(--sui-fs-md); font-weight: 500; font-family: var(--sui-font-mono); }
.sub-agent-item-desc { font-size: var(--sui-fs-xs); color: var(--sui-fg-muted); margin-top: 3px; }

/* ===== Chat (input bar + stop bar — used by ChatPanel) ===== */
.chat-stop-bar {
  display: flex;
  justify-content: center;
  padding: var(--sui-sp-1) var(--sui-sp-5);
  flex-shrink: 0;
}
.chat-input-bar {
  display: flex;
  gap: var(--sui-sp-3);
  padding: var(--sui-sp-5) var(--sui-sp-7);
  border-top: 1px solid var(--sui-border);
  background: var(--sui-bg-page);
  flex-shrink: 0;
}
.chat-input-bar .rich-input {
  flex: 1;
  padding: var(--sui-sp-3) var(--sui-sp-5);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  font-size: var(--sui-fs-md);
  max-height: 200px;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
  background: var(--sui-bg);
  color: var(--sui-fg);
}
.chat-input-bar .rich-input:focus-within { border-color: var(--sui-fg); }

/* ===== Markdown content (used by AboutView via v-html) ===== */
.md-content { white-space: normal; line-height: 1.65; }
.md-content p { margin: 0 0 var(--sui-sp-3); }
.md-content p:last-child { margin-bottom: 0; }
.md-content h1, .md-content h2, .md-content h3, .md-content h4 { margin: var(--sui-sp-4) 0 5px; font-weight: 700; line-height: 1.3; }
.md-content h1 { font-size: 1.2em; }
.md-content h2 { font-size: 1.1em; }
.md-content h3 { font-size: 1em; }
.md-content ul, .md-content ol { margin: 0 0 var(--sui-sp-3); padding-left: var(--sui-sp-8); }
.md-content li { margin-bottom: 2px; }
.md-content pre { background: rgba(0,0,0,0.06); border-radius: 5px; padding: var(--sui-sp-3) var(--sui-sp-4); overflow-x: auto; margin: var(--sui-sp-2) 0; }
.md-content code { font-family: var(--sui-font-mono); font-size: var(--sui-fs-sm); background: rgba(0,0,0,0.06); padding: 1px var(--sui-sp-1); border-radius: 3px; }
.md-content pre code { background: none; padding: 0; font-size: var(--sui-fs-xs); }
.md-content blockquote { border-left: 3px solid var(--sui-border-strong); margin: var(--sui-sp-2) 0; padding: 3px var(--sui-sp-4); color: var(--sui-fg-muted); }
.md-content strong { font-weight: 700; }
.md-content em { font-style: italic; }
.md-content a { color: inherit; text-decoration: underline; }
.md-content hr { border: none; border-top: 1px solid var(--sui-border); margin: var(--sui-sp-4) 0; }
.md-content table { margin: var(--sui-sp-2) 0; font-size: var(--sui-fs-sm); }
.md-content table th, .md-content table td { padding: var(--sui-sp-1) var(--sui-sp-3); border: 1px solid var(--sui-border); }
.md-content table th { background: var(--sui-bg-soft); font-weight: 600; }

/* ===== Hamburger & Sidebar overlay ===== */
.hamburger-btn {
  background: none;
  border: none;
  font-size: 22px;
  cursor: pointer;
  padding: var(--sui-sp-1) var(--sui-sp-3);
  color: var(--sui-fg);
}
.sidebar-overlay {
  position: fixed;
  inset: 0;
  background: var(--sui-mask-soft);
  z-index: 99;
}

/* ===== Mobile Card List (shared across all table views) ===== */
.card-list {
  display: flex;
  flex-direction: column;
  gap: var(--sui-sp-3);
}
.mobile-card {
  background: var(--sui-bg);
  border: 1px solid var(--sui-border);
  border-radius: var(--sui-radius-lg);
  padding: var(--sui-sp-5);
}
.mobile-card-header {
  font-weight: 600;
  font-size: var(--sui-fs-lg);
  margin-bottom: var(--sui-sp-3);
}
.mobile-card-fields {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sui-sp-1) var(--sui-sp-4);
  font-size: var(--sui-fs-md);
  margin-bottom: var(--sui-sp-4);
}
.mobile-card-label {
  color: var(--sui-fg-disabled);
  font-size: var(--sui-fs-sm);
}
.mobile-card-value {
  color: var(--sui-fg);
  overflow: hidden;
  text-overflow: ellipsis;
}
.mobile-card-ops {
  display: flex;
  gap: var(--sui-sp-2);
  flex-wrap: wrap;
}
.mobile-card-empty {
  text-align: center;
  color: var(--sui-fg-disabled);
  padding: var(--sui-sp-8);
}

@media (max-width: 768px) {
  /* Sidebar drawer */
  .sidebar-mobile {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 200px;
    z-index: 100;
    background: var(--sui-bg-page);
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 2px 0 8px rgba(0,0,0,0.1);
  }
  .sidebar-mobile.sidebar-open { transform: translateX(0); }

  .main-content { padding: 0 !important; }
  .topbar { padding: 0 var(--sui-sp-5); }
  table { font-size: var(--sui-fs-md); }
  .ops-cell { gap: var(--sui-sp-1); }
}

/* ===== Dark-only fine-tuning that tokens can't express ===== */
html[data-theme="dark"] .md-content pre { background: rgba(255,255,255,0.06); }
html[data-theme="dark"] .md-content code { background: rgba(255,255,255,0.08); }
</style>
