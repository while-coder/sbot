<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/api'
import { store, applyMcpList } from '@/store'
import { useToast } from '@/composables/useToast'
import { fetchLatestRelease, compareSemver, GITHUB_REPO_URL, GITHUB_RELEASES_URL } from 'sbot.commons'
import { useResponsive } from '../composables/useResponsive'
import { saveLocale } from '@/i18n'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const { show } = useToast()
const { isMobile } = useResponsive()
const sidebarOpen = ref(false)

const menuGroups = computed(() => [
  {
    group: t('nav.chat'),
    items: [
      { label: t('nav.chat'), key: '/chat' },
      { label: t('nav.channels'), key: '/channels' },
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
    group: t('nav.group_admin'),
    items: [
      { label: t('nav.processes'), key: '/processes' },
      { label: t('nav.heartbeats'), key: '/heartbeats' },
      { label: t('nav.scheduler'), key: '/scheduler' },
      { label: t('nav.todo'), key: '/todo' },
      { label: t('nav.token_usage'), key: '/token-usage' },
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
      apiFetch('/api/sessions'),
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
      <div class="sidebar" :class="{ 'sidebar-open': sidebarOpen, 'sidebar-mobile': isMobile }">
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
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  color: #1c1c1c;
  background: #fff;
}

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
  padding: 0 20px;
  height: 52px;
  border-bottom: 1px solid #e8e6e3;
  background: #fff;
  flex-shrink: 0;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.topbar-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.topbar-link {
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #3d3d3d;
  text-decoration: none;
  border-radius: 5px;
  transition: background 0.15s, color 0.15s;
}
.topbar-link:hover {
  background: #f5f4f2;
  color: #1c1c1c;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.topbar-icon-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  color: #6b6b6b;
  transition: background 0.15s, color 0.15s;
}
.topbar-icon-btn:hover {
  background: #f5f4f2;
  color: #1c1c1c;
}
.lang-dropdown {
  position: absolute;
  top: 38px;
  right: 0;
  background: #fff;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  min-width: 150px;
  padding: 4px;
  z-index: 100;
}
.lang-option {
  padding: 8px 14px;
  font-size: 13px;
  color: #3d3d3d;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s;
}
.lang-option:hover {
  background: #f5f4f2;
}
.lang-option.active {
  font-weight: 600;
  color: #1c1c1c;
}
.topbar-title {
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1c;
}
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.sidebar {
  width: 168px;
  border-right: 1px solid #e8e6e3;
  background: #fff;
  padding: 8px;
  flex-shrink: 0;
  overflow-y: auto;
}
.sidebar-group-label {
  padding: 16px 8px 5px;
  font-size: 12px;
  font-weight: 700;
  color: #3d3d3d;
  user-select: none;
  border-top: 1px solid #e8e6e3;
  margin-top: 4px;
}
.sidebar-group-label:first-of-type {
  padding-top: 6px;
  border-top: none;
  margin-top: 0;
}
.sidebar-item {
  padding: 8px 12px;
  font-size: 13px;
  color: #6b6b6b;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  border-radius: 6px;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.update-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
  margin-left: auto;
}
.sidebar-item:hover { background: #f5f4f2; color: #1c1c1c; }
.sidebar-item.active { background: #fafaf9; color: #1c1c1c; font-weight: 600; }
.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Page layout */
.page-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid #e8e6e3;
  background: #fff;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.table-link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  font-family: monospace;
  color: #4f46e5;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: text-decoration-color .15s, color .15s;
}
.table-link-btn:hover {
  color: #3730a3;
  text-decoration-color: #3730a3;
}
.chat-info-chip {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  padding: 3px 10px;
  background: #f4f3f1;
  border: 1px solid #e8e6e3;
  border-radius: 12px;
  color: #555;
  cursor: pointer;
  transition: background .15s, border-color .15s;
  white-space: nowrap;
}
.chat-info-chip:hover {
  background: #eceae6;
  border-color: #ccc;
}
.page-toolbar-title {
  font-weight: 600;
  font-size: 14px;
  color: #1c1c1c;
}
.page-content {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
.card {
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.card-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b6b6b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

/* Forms */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: #3d3d3d;
}
.form-group input,
.form-group select,
.form-group textarea {
  padding: 6px 10px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  font-size: 13px;
  color: #1c1c1c;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus { border-color: #1c1c1c; }
.form-group textarea { resize: vertical; }
.form-group input:disabled { background: #f5f4f2; color: #9b9b9b; }
.form-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #e8e6e3;
}
.form-details {
  margin-top: 12px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  overflow: hidden;
}
.form-details-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #3b3a38;
  cursor: pointer;
  user-select: none;
  background: #fafaf9;
  list-style: none;
}
.form-details-summary::-webkit-details-marker { display: none; }
.form-details-summary::before { content: '▶'; font-size: 10px; color: #9b9b9b; transition: transform .15s; }
details[open] > .form-details-summary::before { transform: rotate(90deg); }
.form-details-badge {
  margin-left: 4px;
  background: #3b82f6;
  color: #fff;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 700;
  padding: 0 6px;
  min-width: 18px;
  text-align: center;
}
.form-details-body {
  padding: 12px;
  border-top: 1px solid #e8e6e3;
}
.form-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #6b6b6b;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.hint { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
.inline-form { display: flex; gap: 16px; flex-wrap: wrap; }
.inline-form .form-group { flex: 1; min-width: 200px; }

/* Buttons */
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s, opacity 0.15s;
  font-family: inherit;
  line-height: 1.4;
}
button:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: #1c1c1c; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #333; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover:not(:disabled) { background: #dc2626; }
.btn-outline { background: transparent; border: 1px solid #d6d4d0; color: #3d3d3d; }
.btn-outline:hover:not(:disabled) { background: #f5f4f2; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* Table */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
table th, table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e8e6e3;
}
table th {
  font-weight: 600;
  color: #6b6b6b;
  background: #fafaf9;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
table tr:hover td { background: #fafaf9; }
.ops-cell { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-box {
  background: #fff;
  border-radius: 10px;
  width: 520px;
  max-width: 96vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 40px rgba(0,0,0,0.1);
}
.modal-box.wide { width: 660px; }
.modal-box.xl   { width: min(92vw, 1040px); }
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
}
.modal-header h3 { font-size: 15px; font-weight: 600; color: #1c1c1c; }
.modal-header-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #e8e6e3;
  flex-shrink: 0;
}
.modal-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #9b9b9b;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.modal-close:hover { color: #3d3d3d; }
.modal-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #e8e6e3;
  flex-shrink: 0;
}

/* Check items */
.check-row { display: flex; flex-wrap: wrap; gap: 8px; }
.check-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  background: #fafaf9;
  user-select: none;
}
.check-item:hover { background: #ebe9e6; }
.check-item input[type=checkbox] { cursor: pointer; }
.tag-select-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 28px; }
.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #e8e6e3;
  border-radius: 4px;
  font-size: 12px;
  color: #3b3a38;
}
.tag-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: #888;
  padding: 0 1px;
}
.tag-remove:hover { color: #e53e3e; }
.tag-add-select {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px dashed #bbb;
  border-radius: 4px;
  background: #fafaf9;
  color: #555;
  cursor: pointer;
  height: 24px;
}
.section-disabled { opacity: 0.4; pointer-events: none; user-select: none; }
.section-disabled * { pointer-events: none; }

/* MCP Tools Viewer */
.tools-loading { text-align:center; color:#9b9b9b; padding:40px 0; font-size:14px; }
.tools-count { font-size:12px; color:#9b9b9b; font-weight:400; margin-left:8px; }
.tools-list { list-style:none; margin:0; padding:0; }
.tools-list li { padding:12px 20px; border-bottom:1px solid #f0efed; }
.tools-list li:last-child { border-bottom:none; }
.tools-list li:hover { background:#fafaf9; }
.tool-header { display:flex; align-items:center; gap:8px; }
.tool-header .tool-name { flex:1; }
.tool-name { font-size:13px; font-weight:600; color:#1c1c1c; font-family:'Consolas','Monaco',monospace; cursor:pointer; user-select:none; }
.tool-name::before { content:'\25B6'; font-size:9px; margin-right:6px; color:#9b9b9b; display:inline-block; transition:transform .15s; }
.tool-name.expanded::before { transform:rotate(90deg); }
.tools-approve-bar { display:flex; align-items:center; gap:10px; padding:8px 20px; border-bottom:1px solid #f0efed; background:#fafaf9; }
.tools-approve-label { font-size:12px; color:#6b6b6b; flex:1; }
.auto-approve-switch { display:flex; align-items:center; gap:6px; cursor:pointer; flex-shrink:0; }
.auto-approve-switch input[type=checkbox] { display:none; }
.switch-track { position:relative; display:inline-block; width:28px; height:16px; border-radius:8px; background:#d1d5db; transition:background .2s; flex-shrink:0; }
.switch-track::after { content:''; position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:#fff; transition:transform .2s; }
.auto-approve-switch input:checked + .switch-track { background:#1c1c1c; }
.auto-approve-switch input:checked + .switch-track::after { transform:translateX(12px); }
.switch-label { font-size:11px; color:#9b9b9b; white-space:nowrap; }
.tool-desc { font-size:12px; color:#6b6b6b; margin-top:3px; line-height:1.5; }
.tool-params { display:none; margin-top:8px; border-left:2px solid #e8e6e3; padding-left:12px; }
.tool-params.show { display:block; }
.tool-param { padding:5px 0; font-size:12px; line-height:1.5; }
.tool-param + .tool-param { border-top:1px solid #f5f4f2; }
.param-name { font-family:'Consolas','Monaco',monospace; font-weight:600; color:#1c1c1c; }
.param-type { color:#8b5cf6; font-size:11px; margin-left:4px; }
.param-required { color:#ef4444; font-size:10px; font-weight:600; margin-left:4px; }
.param-desc { color:#6b6b6b; margin-top:1px; }
.param-enum { color:#0891b2; font-size:11px; font-family:'Consolas','Monaco',monospace; }
.param-default { color:#9b9b9b; font-size:11px; }
.tool-no-params { font-size:12px; color:#9b9b9b; font-style:italic; padding:4px 0; }

/* Toast */
.toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  background: #1c1c1c;
  color: #fff;
  z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  pointer-events: none;
}
.toast.error { background: #ef4444; }

/* Sub-agent */
.sub-agent-item {
  padding: 8px 12px;
  margin-bottom: 8px;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  background: #fafaf9;
}
.sub-agent-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sub-agent-item-name { font-size: 13px; font-weight: 500; font-family: monospace; }
.sub-agent-item-desc { font-size: 11px; color: #6b6b6b; margin-top: 3px; }

/* Chat */
.history-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}
.msg-row { display: flex; flex-direction: column; gap: 4px; }
.msg-row.human { align-items: flex-end; }
.msg-row.ai { align-items: flex-start; }
.msg-role-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.msg-time {
  font-size: 10px;
  opacity: 0.5;
}
.msg-bubble.human .msg-time { color: #fff; }
.msg-bubble.ai    .msg-time { color: #3d3d3d; }
.msg-queued-tag {
  font-size: 10px;
  color: #fff;
  background: rgba(255,255,255,.25);
  padding: 0 5px;
  border-radius: 3px;
  line-height: 16px;
}
.msg-bubble.human.queued { opacity: .65; }
.msg-date-sep {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 8px;
  color: #b0aead;
  font-size: 12px;
}
.msg-date-sep::before,
.msg-date-sep::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #ebe9e6;
}
.msg-bubble {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.msg-bubble.human { background: #1c1c1c; color: #fff; border-bottom-right-radius: 3px; max-width: 85%; }
.msg-bubble.ai { background: #f5f4f2; color: #1c1c1c; border-bottom-left-radius: 3px; }
.msg-bubble.tool { background: #fefce8; color: #713f12; font-family: monospace; font-size: 12px; }
.msg-bubble.streaming { opacity: 0.85; }
.md-content { white-space: normal; line-height: 1.65; }
.md-content p { margin: 0 0 8px; }
.md-content p:last-child { margin-bottom: 0; }
.md-content h1, .md-content h2, .md-content h3, .md-content h4 { margin: 10px 0 5px; font-weight: 700; line-height: 1.3; }
.md-content h1 { font-size: 1.2em; }
.md-content h2 { font-size: 1.1em; }
.md-content h3 { font-size: 1em; }
.md-content ul, .md-content ol { margin: 0 0 8px; padding-left: 20px; }
.md-content li { margin-bottom: 2px; }
.md-content pre { background: rgba(0,0,0,0.06); border-radius: 5px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }
.md-content code { font-family: 'Consolas','Monaco',monospace; font-size: 12px; background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; }
.md-content pre code { background: none; padding: 0; font-size: 11px; }
.md-content blockquote { border-left: 3px solid #d6d4d0; margin: 6px 0; padding: 3px 10px; color: #6b6b6b; }
.md-content strong { font-weight: 700; }
.md-content em { font-style: italic; }
.md-content a { color: inherit; text-decoration: underline; }
.md-content hr { border: none; border-top: 1px solid #e8e6e3; margin: 10px 0; }
.md-content table { margin: 6px 0; font-size: 12px; }
.md-content table th, .md-content table td { padding: 4px 8px; border: 1px solid #e8e6e3; }
.md-content table th { background: #f5f4f2; font-weight: 600; }
.msg-role {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.msg-tool-calls {
  background: #fafaf9;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 6px;
  font-size: 12px;
  width: 100%;
  box-sizing: border-box;
}
.tool-call-item { border: 1px solid #e8e6e3; border-radius: 6px; margin-top: 6px; overflow: hidden; }
.tool-call-header {
  padding: 6px 10px;
  background: #f5f4f2;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  user-select: none;
}
.tool-call-header::after { content: '▶'; font-size: 10px; color: #9b9b9b; margin-left: auto; flex-shrink: 0; }
.tool-call-header.expanded::after { content: '▼'; }
.tool-call-name { font-family: monospace; color: #1c1c1c; font-size: 12px; flex-shrink: 0; }
.tool-call-inline-args { font-family: monospace; font-size: 11px; color: #7a7a7a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-call-result-preview { font-size: 11px; color: #9b9b9b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.tool-call-header.expanded .tool-call-result-preview { display: none; }
.tool-call-detail { display: none; padding: 8px 10px; }
.tool-call-detail.show { display: block; }
.tool-call-args {
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  color: #3d3d3d;
  background: #fafaf9;
  padding: 6px 8px;
  border-radius: 4px;
  max-height: 300px;
  overflow-y: auto;
}
.tool-call-result { margin-top: 6px; padding-top: 6px; border-top: 1px solid #e8e6e3; }
.tool-call-result-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.msg-role.has-think { display: flex; align-items: center; gap: 6px; }
.tool-call-result-label { font-weight: 600; color: #6b6b6b; font-size: 11px; text-transform: uppercase; }
.tool-result-content { font-size: 12px; line-height: 1.5; overflow-x: hidden; word-break: break-word; }
.tool-result-content pre { background: rgba(0,0,0,0.04); border-radius: 4px; padding: 6px 8px; margin: 4px 0; font-size: 11px; }
.tool-result-content code { font-size: 11px; }
.tool-result-content p { margin: 0 0 4px; }
.tool-result-content p:last-child { margin-bottom: 0; }
.tool-result-content table { font-size: 11px; }
.tool-result-content table th, .tool-result-content table td { padding: 2px 6px; }
/* ── Think viewer ── */
.think-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 10px;
  font-size: 11px; font-weight: 600; color: #7c3aed;
  cursor: pointer; user-select: none; border-radius: 4px;
  background: #f5f3ff; border: 1px solid #ddd6fe;
  transition: all 0.15s ease;
  white-space: nowrap; vertical-align: middle;
}
.think-toggle:hover { background: #ede9fe; color: #6d28d9; border-color: #c4b5fd; }
.think-toggle-human { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.3); color: #e9d5ff; }
.think-toggle-human:hover { background: rgba(255,255,255,0.25); border-color: rgba(255,255,255,0.4); color: #fff; }
.chat-stop-bar {
  display: flex;
  justify-content: center;
  padding: 4px 12px;
  flex-shrink: 0;
}
.chat-input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e8e6e3;
  background: #fff;
  flex-shrink: 0;
}
.chat-input-bar .rich-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  font-size: 13px;
  max-height: 200px;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
}
.chat-input-bar .rich-input:focus-within { border-color: #1c1c1c; }
.chat-queue {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px;
  border-top: 1px solid #e8e6e3;
  background: #fffbeb;
  flex-shrink: 0;
}
.chat-queue-label { font-size: 12px; font-weight: 600; color: #92400e; }
.chat-queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
}
.chat-queue-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3d3d3d; }
.chat-queue-del { background: none; border: none; cursor: pointer; color: #9b9b9b; font-size: 16px; padding: 0; line-height: 1; }

/* Row dropdown */
.row-dropdown {
  position: relative;
  display: inline-block;
}
.row-dropdown-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 200;
  background: #fff;
  border: 1px solid #e8e6e3;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,.12);
  min-width: 90px;
  padding: 4px 0;
}
.row-dropdown-menu button {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-radius: 0;
  text-align: left;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  color: #3d3d3d;
}
.row-dropdown-menu button:hover:not(:disabled) {
  background: #f5f4f2;
}
.row-dropdown-menu button:disabled {
  color: #b0b0b0;
  cursor: default;
}

/* ── Inline images ── */
.inline-image { margin-top: 8px; }
.inline-image-thumb {
  max-width: 240px;
  max-height: 240px;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity .15s;
}
.inline-image-thumb:hover { opacity: .85; }

/* ── Inline audio ── */
.inline-audio { margin-top: 8px; }
.inline-audio audio { max-width: 100%; border-radius: 6px; }

/* ── Image lightbox ── */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0,0,0,.7);
  display: flex;
  align-items: center;
  justify-content: center;
}
.lightbox-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 90vw;
  max-height: 90vh;
}
.lightbox-img {
  max-width: 90vw;
  max-height: 80vh;
  border-radius: 8px;
  object-fit: contain;
}
.lightbox-actions {
  display: flex;
  gap: 8px;
}

/* ===== Hamburger & Drawer ===== */
.hamburger-btn {
  background: none;
  border: none;
  font-size: 22px;
  cursor: pointer;
  padding: 4px 8px;
  color: #1c1c1c;
}
.sidebar-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  z-index: 99;
}

/* ===== Mobile Card List (shared across all table views) ===== */
.card-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mobile-card {
  background: #fff;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  padding: 12px;
}
.mobile-card-header {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 8px;
}
.mobile-card-fields {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  font-size: 13px;
  margin-bottom: 10px;
}
.mobile-card-label {
  color: #9b9b9b;
  font-size: 12px;
}
.mobile-card-value {
  color: #1c1c1c;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mobile-card-ops {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.mobile-card-empty {
  text-align: center;
  color: #9b9b9b;
  padding: 20px;
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
    background: #fff;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 2px 0 8px rgba(0,0,0,0.1);
  }
  .sidebar-mobile.sidebar-open {
    transform: translateX(0);
  }

  /* Spacing */
  .main-content {
    padding: 0 !important;
  }
  .topbar {
    padding: 0 12px;
  }
  .page-content {
    padding: 12px;
  }

  /* Modal fullscreen */
  .modal-box,
  .picker-box {
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    max-height: 100vh !important;
    border-radius: 0 !important;
    margin: 0 !important;
  }
  .modal-overlay {
    align-items: stretch !important;
    padding: 0 !important;
  }
  .modal-header {
    flex-shrink: 0;
    position: sticky;
    top: 0;
    background: #fff;
    z-index: 1;
    border-bottom: 1px solid #e8e6e3;
  }
  .modal-body {
    flex: 1;
    overflow-y: auto;
  }
  .modal-footer {
    flex-shrink: 0;
    position: sticky;
    bottom: 0;
    background: #fff;
    border-top: 1px solid #e8e6e3;
  }

  /* Forms */
  .form-group input,
  .form-group select,
  .form-group textarea {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
  }
  .inline-form {
    flex-direction: column;
  }

  /* Toolbar */
  .page-toolbar {
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Tables base */
  table {
    font-size: 13px;
  }
  .ops-cell {
    flex-wrap: wrap;
    gap: 4px;
  }
  .btn-sm {
    padding: 3px 8px;
    font-size: 12px;
  }
}

/* Theme dropdown */
.theme-dropdown {
  position: absolute;
  top: 38px;
  right: 0;
  background: #fff;
  border: 1px solid #e8e6e3;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  min-width: 120px;
  padding: 4px;
  z-index: 100;
}
.theme-option {
  padding: 8px 14px;
  font-size: 13px;
  color: #3d3d3d;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s;
}
.theme-option:hover { background: #f5f4f2; }
.theme-option.active { font-weight: 600; color: #1c1c1c; }

/* ===== Dark Theme ===== */
html[data-theme="dark"] body { color: #d4d4d4; background: #1a1a1a; }
html[data-theme="dark"] .topbar { background: #1a1a1a; border-bottom-color: #333; }
html[data-theme="dark"] .topbar-title { color: #e0e0e0; }
html[data-theme="dark"] .topbar-link { color: #aaa; }
html[data-theme="dark"] .topbar-link:hover { background: #2a2a2a; color: #e0e0e0; }
html[data-theme="dark"] .topbar-icon-btn { color: #999; }
html[data-theme="dark"] .topbar-icon-btn:hover { background: #2a2a2a; color: #e0e0e0; }
html[data-theme="dark"] .lang-dropdown,
html[data-theme="dark"] .theme-dropdown { background: #252525; border-color: #333; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
html[data-theme="dark"] .lang-option,
html[data-theme="dark"] .theme-option { color: #ccc; }
html[data-theme="dark"] .lang-option:hover,
html[data-theme="dark"] .theme-option:hover { background: #333; }
html[data-theme="dark"] .lang-option.active,
html[data-theme="dark"] .theme-option.active { color: #fff; }
html[data-theme="dark"] .sidebar { background: #1a1a1a; border-right-color: #333; }
html[data-theme="dark"] .sidebar-group-label { color: #aaa; border-top-color: #333; }
html[data-theme="dark"] .sidebar-item { color: #999; }
html[data-theme="dark"] .sidebar-item:hover { background: #2a2a2a; color: #e0e0e0; }
html[data-theme="dark"] .sidebar-item.active { background: #252525; color: #e0e0e0; }
html[data-theme="dark"] .page-toolbar { background: #1a1a1a; border-bottom-color: #333; }
html[data-theme="dark"] .page-toolbar-title { color: #e0e0e0; }
html[data-theme="dark"] .card { background: #222; border-color: #333; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
html[data-theme="dark"] .card-title { color: #999; }
html[data-theme="dark"] .form-group label { color: #ccc; }
html[data-theme="dark"] .form-group input,
html[data-theme="dark"] .form-group select,
html[data-theme="dark"] .form-group textarea { background: #2a2a2a; border-color: #444; color: #d4d4d4; }
html[data-theme="dark"] .form-group input:focus,
html[data-theme="dark"] .form-group select:focus,
html[data-theme="dark"] .form-group textarea:focus { border-color: #888; }
html[data-theme="dark"] .form-group input:disabled { background: #222; color: #666; }
html[data-theme="dark"] .btn-primary { background: #e0e0e0; color: #1a1a1a; }
html[data-theme="dark"] .btn-primary:hover:not(:disabled) { background: #fff; }
html[data-theme="dark"] .btn-outline { border-color: #444; color: #ccc; }
html[data-theme="dark"] .btn-outline:hover:not(:disabled) { background: #2a2a2a; }
html[data-theme="dark"] .btn-danger { background: #dc2626; }
html[data-theme="dark"] table th { background: #252525; color: #999; border-bottom-color: #333; }
html[data-theme="dark"] table td { border-bottom-color: #333; color: #d4d4d4; }
html[data-theme="dark"] table tr:hover td { background: #252525; }
html[data-theme="dark"] .modal-overlay { background: rgba(0,0,0,0.6); }
html[data-theme="dark"] .modal-box { background: #222; box-shadow: 0 8px 40px rgba(0,0,0,0.3); }
html[data-theme="dark"] .modal-header { border-bottom-color: #333; }
html[data-theme="dark"] .modal-header h3 { color: #e0e0e0; }
html[data-theme="dark"] .modal-body { color: #d4d4d4; }
html[data-theme="dark"] .modal-footer { border-top-color: #333; }
html[data-theme="dark"] .modal-close { color: #666; }
html[data-theme="dark"] .modal-close:hover { color: #ccc; }
html[data-theme="dark"] .toast { background: #e0e0e0; color: #1a1a1a; }
html[data-theme="dark"] .toast.error { background: #ef4444; color: #fff; }
html[data-theme="dark"] .hint { color: #777; }
html[data-theme="dark"] .form-section { border-top-color: #333; }
html[data-theme="dark"] .form-details { border-color: #333; }
html[data-theme="dark"] .form-details-summary { background: #252525; color: #ccc; }
html[data-theme="dark"] .form-details-body { border-top-color: #333; }
html[data-theme="dark"] .form-section-title { color: #999; }
html[data-theme="dark"] .check-item { background: #252525; border-color: #333; color: #ccc; }
html[data-theme="dark"] .check-item:hover { background: #333; }
html[data-theme="dark"] .tag-item { background: #333; color: #ccc; }
html[data-theme="dark"] .tag-add-select { background: #252525; border-color: #555; color: #999; }
html[data-theme="dark"] .row-dropdown-menu { background: #252525; border-color: #333; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
html[data-theme="dark"] .row-dropdown-menu button { color: #ccc; }
html[data-theme="dark"] .row-dropdown-menu button:hover:not(:disabled) { background: #333; }
html[data-theme="dark"] .msg-bubble.ai { background: #2a2a2a; color: #d4d4d4; }
html[data-theme="dark"] .msg-bubble.tool { background: #2a2500; color: #d4b860; }
html[data-theme="dark"] .msg-tool-calls { background: #252525; border-color: #333; }
html[data-theme="dark"] .tool-call-header { background: #2a2a2a; }
html[data-theme="dark"] .tool-call-item { border-color: #333; }
html[data-theme="dark"] .tool-call-name { color: #e0e0e0; }
html[data-theme="dark"] .tool-call-args { background: #252525; color: #ccc; }
html[data-theme="dark"] .tool-call-result { border-top-color: #333; }
html[data-theme="dark"] .chat-input-bar { background: #1a1a1a; border-top-color: #333; }
html[data-theme="dark"] .chat-input-bar .rich-input { background: #2a2a2a; border-color: #444; color: #d4d4d4; }
html[data-theme="dark"] .chat-input-bar .rich-input:focus-within { border-color: #888; }
html[data-theme="dark"] .chat-queue { background: #2a2500; border-top-color: #333; }
html[data-theme="dark"] .chat-queue-label { color: #d4b860; }
html[data-theme="dark"] .chat-queue-item { background: #252525; border-color: #444; }
html[data-theme="dark"] .chat-queue-text { color: #ccc; }
html[data-theme="dark"] .chat-info-chip { background: #2a2a2a; border-color: #444; color: #999; }
html[data-theme="dark"] .chat-info-chip:hover { background: #333; border-color: #555; }
html[data-theme="dark"] .think-toggle { background: #2d2540; border-color: #4a3580; color: #a78bfa; }
html[data-theme="dark"] .think-toggle:hover { background: #3d3060; border-color: #6d54b0; color: #c4b5fd; }
html[data-theme="dark"] .md-content pre { background: rgba(255,255,255,0.06); }
html[data-theme="dark"] .md-content code { background: rgba(255,255,255,0.08); }
html[data-theme="dark"] .md-content blockquote { border-left-color: #444; color: #999; }
html[data-theme="dark"] .md-content hr { border-top-color: #333; }
html[data-theme="dark"] .md-content table th { background: #2a2a2a; }
html[data-theme="dark"] .md-content table td,
html[data-theme="dark"] .md-content table th { border-color: #333; }
html[data-theme="dark"] .mobile-card { background: #222; border-color: #333; }
html[data-theme="dark"] .mobile-card-label { color: #777; }
html[data-theme="dark"] .mobile-card-value { color: #d4d4d4; }
html[data-theme="dark"] .hamburger-btn { color: #e0e0e0; }
html[data-theme="dark"] .sidebar-overlay { background: rgba(0,0,0,0.5); }
html[data-theme="dark"] .sub-agent-item { background: #252525; border-color: #333; }
html[data-theme="dark"] .sub-agent-item-name { color: #e0e0e0; }
html[data-theme="dark"] .sub-agent-item-desc { color: #999; }
html[data-theme="dark"] .tools-list li:hover { background: #252525; }
html[data-theme="dark"] .tools-list li { border-bottom-color: #333; }
html[data-theme="dark"] .tool-name { color: #e0e0e0; }
html[data-theme="dark"] .tool-desc { color: #999; }
html[data-theme="dark"] .tools-approve-bar { background: #252525; border-bottom-color: #333; }
html[data-theme="dark"] .param-name { color: #e0e0e0; }
html[data-theme="dark"] .param-desc { color: #999; }
html[data-theme="dark"] .tool-params { border-left-color: #333; }
html[data-theme="dark"] .tool-param + .tool-param { border-top-color: #333; }
html[data-theme="dark"] .table-link-btn { color: #818cf8; }
html[data-theme="dark"] .table-link-btn:hover { color: #a5b4fc; text-decoration-color: #a5b4fc; }
html[data-theme="dark"] .msg-date-sep { color: #666; }
html[data-theme="dark"] .msg-date-sep::before,
html[data-theme="dark"] .msg-date-sep::after { background: #333; }
html[data-theme="dark"] .section-disabled { opacity: 0.3; }
html[data-theme="dark"] .lightbox-overlay { background: rgba(0,0,0,0.85); }
@media (max-width: 768px) {
  html[data-theme="dark"] .sidebar-mobile { background: #1a1a1a; }
  html[data-theme="dark"] .modal-header { background: #222; }
  html[data-theme="dark"] .modal-footer { background: #222; }
}

.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.usage-table th {
  padding: 6px 10px;
  font-weight: 600;
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
  font-size: 12px;
}
.usage-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #f1f5f9;
  font-variant-numeric: tabular-nums;
}
</style>
