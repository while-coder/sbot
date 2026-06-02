export type WorkbenchTabType = 'files' | 'git' | 'terminal'

export interface WorkbenchTabSnapshot {
  id: string
  type: WorkbenchTabType
  root?: string
  title?: string
}

export interface WorkbenchTabsState {
  tabs: WorkbenchTabSnapshot[]
  activeTabId: string
  nextTabSeq: number
  nextTerminalSeq: number
}

interface WorkbenchTabsStore {
  version: 1
  recentKeys: string[]
  byKey: Record<string, WorkbenchTabsState>
}

const STORAGE_KEY = 'sbot:workbench:tabs:v1'
const MAX_KEYS = 30
const MAX_TABS_PER_KEY = 24
const MAX_STORAGE_CHARS = 200_000

export function defaultWorkbenchTabsState(): WorkbenchTabsState {
  return { tabs: [], activeTabId: '', nextTabSeq: 0, nextTerminalSeq: 0 }
}

export function loadWorkbenchTabsState(key: string | undefined): WorkbenchTabsState {
  const k = normalizeKey(key)
  if (!k) return defaultWorkbenchTabsState()
  return sanitizeState(readStore().byKey[k])
}

export function saveWorkbenchTabsState(key: string | undefined, state: WorkbenchTabsState): void {
  const k = normalizeKey(key)
  if (!k) return

  const store = readStore()
  store.byKey[k] = sanitizeState(state)
  store.recentKeys = [k, ...store.recentKeys.filter(item => item !== k)].slice(0, MAX_KEYS)

  for (const existing of Object.keys(store.byKey)) {
    if (!store.recentKeys.includes(existing)) delete store.byKey[existing]
  }

  trimStore(store)
  writeStore(store)
}

export function clearWorkbenchTabsState(key: string | undefined): void {
  const k = normalizeKey(key)
  if (!k) return
  const store = readStore()
  if (!store.byKey[k]) return
  delete store.byKey[k]
  store.recentKeys = store.recentKeys.filter(item => item !== k)
  writeStore(store)
}

function readStore(): WorkbenchTabsStore {
  if (typeof localStorage === 'undefined') return emptyStore()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<WorkbenchTabsStore>
    if (parsed.version !== 1 || !parsed.byKey || typeof parsed.byKey !== 'object') return emptyStore()
    return {
      version: 1,
      recentKeys: Array.isArray(parsed.recentKeys) ? parsed.recentKeys.filter(isString) : [],
      byKey: Object.fromEntries(
        Object.entries(parsed.byKey)
          .map(([k, v]) => [k, sanitizeState(v)])
          .filter(([k]) => Boolean(k)),
      ),
    }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: WorkbenchTabsStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota/security errors are non-fatal: tab restore is a convenience.
  }
}

function trimStore(store: WorkbenchTabsStore): void {
  store.recentKeys = store.recentKeys.slice(0, MAX_KEYS)
  while (JSON.stringify(store).length > MAX_STORAGE_CHARS && store.recentKeys.length > 1) {
    const stale = store.recentKeys.pop()
    if (stale) delete store.byKey[stale]
  }
}

function sanitizeState(input: unknown): WorkbenchTabsState {
  const fallback = defaultWorkbenchTabsState()
  if (!input || typeof input !== 'object') return fallback
  const value = input as Partial<WorkbenchTabsState>
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.map(sanitizeTab).filter((t): t is WorkbenchTabSnapshot => t !== null).slice(0, MAX_TABS_PER_KEY)
    : []
  const activeTabId = isString(value.activeTabId) && tabs.some(t => t.id === value.activeTabId)
    ? value.activeTabId
    : (tabs[0]?.id ?? '')
  return {
    tabs,
    activeTabId,
    nextTabSeq: sanitizeSeq(value.nextTabSeq, tabs),
    nextTerminalSeq: sanitizeSeq(value.nextTerminalSeq, tabs.filter(t => t.type === 'terminal')),
  }
}

function sanitizeTab(input: unknown): WorkbenchTabSnapshot | null {
  if (!input || typeof input !== 'object') return null
  const v = input as Partial<WorkbenchTabSnapshot>
  if (!isString(v.id) || !v.id) return null
  const type: WorkbenchTabType | null = v.type === 'files' || v.type === 'git' || v.type === 'terminal' ? v.type : null
  if (!type) return null
  const tab: WorkbenchTabSnapshot = { id: v.id, type }
  if (isString(v.root) && v.root) tab.root = v.root
  if (isString(v.title) && v.title) tab.title = v.title
  return tab
}

function sanitizeSeq(value: unknown, tabs: { id: string }[]): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  // Fallback: derive from tab ids so newly created tabs don't collide with restored ones.
  let max = 0
  for (const t of tabs) {
    const m = /-(\d+)$/.exec(t.id)
    if (m) max = Math.max(max, Number(m[1]) || 0)
  }
  return max
}

function normalizeKey(key: string | undefined): string {
  return (key || '').trim()
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function emptyStore(): WorkbenchTabsStore {
  return { version: 1, recentKeys: [], byKey: {} }
}
