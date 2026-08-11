export type ExplorerMode = 'files' | 'git'
export type GitDiffViewMode = 'unified' | 'split'

export interface ExplorerFilesViewState {
  expandedPaths: string[]
  selectedPath: string
}

export interface ExplorerGitViewState {
  selectedPath: string
  diffViewMode: GitDiffViewMode
  showFullDiff: boolean
}

export interface ExplorerViewState {
  mode: ExplorerMode
  treeWidth: number
  treeHeight: number
  files: ExplorerFilesViewState
  git: ExplorerGitViewState
}

interface ExplorerStateStore {
  version: 1
  recentRoots: string[]
  roots: Record<string, ExplorerViewState>
}

const STORAGE_KEY = 'sbot:explorer:view-state:v1'
const MAX_ROOTS = 20
const MAX_EXPANDED_PATHS = 100
const MAX_STORAGE_CHARS = 300_000
const DEFAULT_TREE_WIDTH = 260
const DEFAULT_TREE_HEIGHT = 220

export function defaultExplorerViewState(): ExplorerViewState {
  return {
    mode: 'files',
    treeWidth: DEFAULT_TREE_WIDTH,
    treeHeight: DEFAULT_TREE_HEIGHT,
    files: {
      expandedPaths: [],
      selectedPath: '',
    },
    git: {
      selectedPath: '',
      diffViewMode: 'unified',
      showFullDiff: false,
    },
  }
}

export function loadExplorerViewState(root?: string): ExplorerViewState {
  const key = normalizeRoot(root)
  if (!key) return defaultExplorerViewState()
  return sanitizeViewState(readStore().roots[key])
}

export function saveExplorerViewState(root: string | undefined, state: ExplorerViewState): void {
  const key = normalizeRoot(root)
  if (!key) return

  const store = readStore()
  store.roots[key] = sanitizeViewState(state)
  store.recentRoots = [key, ...store.recentRoots.filter(item => item !== key)].slice(0, MAX_ROOTS)

  for (const rootKey of Object.keys(store.roots)) {
    if (!store.recentRoots.includes(rootKey)) delete store.roots[rootKey]
  }

  trimStore(store)
  writeStore(store)
}

export function mergeExplorerViewState(
  current: ExplorerViewState,
  patch: Partial<ExplorerViewState>,
): ExplorerViewState {
  return sanitizeViewState({
    ...current,
    ...patch,
    files: { ...current.files, ...patch.files },
    git: { ...current.git, ...patch.git },
  })
}

function readStore(): ExplorerStateStore {
  if (typeof localStorage === 'undefined') return emptyStore()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<ExplorerStateStore>
    if (parsed.version !== 1 || !parsed.roots || typeof parsed.roots !== 'object') return emptyStore()
    return {
      version: 1,
      recentRoots: Array.isArray(parsed.recentRoots) ? parsed.recentRoots.filter(isString).map(normalizeRoot).filter(Boolean) : [],
      roots: Object.fromEntries(
        Object.entries(parsed.roots)
          .map(([root, state]) => [normalizeRoot(root), sanitizeViewState(state)])
          .filter(([root]) => Boolean(root)),
      ),
    }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: ExplorerStateStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore quota/security errors. Explorer state is a convenience cache.
  }
}

function trimStore(store: ExplorerStateStore): void {
  store.recentRoots = store.recentRoots.slice(0, MAX_ROOTS)
  while (JSON.stringify(store).length > MAX_STORAGE_CHARS && store.recentRoots.length > 1) {
    const staleRoot = store.recentRoots.pop()
    if (staleRoot) delete store.roots[staleRoot]
  }
}

function sanitizeViewState(input: unknown): ExplorerViewState {
  const fallback = defaultExplorerViewState()
  if (!input || typeof input !== 'object') return fallback
  const value = input as Partial<ExplorerViewState>
  const mode: ExplorerMode = value.mode === 'git' ? 'git' : 'files'
  const treeWidth = sanitizeTreeSize(value.treeWidth, DEFAULT_TREE_WIDTH)
  const treeHeight = sanitizeTreeSize(value.treeHeight, DEFAULT_TREE_HEIGHT)
  const files = value.files && typeof value.files === 'object' ? value.files : {}
  const git = value.git && typeof value.git === 'object' ? value.git : {}

  return {
    mode,
    treeWidth,
    treeHeight,
    files: {
      expandedPaths: sanitizePaths((files as Partial<ExplorerFilesViewState>).expandedPaths),
      selectedPath: sanitizeString((files as Partial<ExplorerFilesViewState>).selectedPath),
    },
    git: {
      selectedPath: sanitizeString((git as Partial<ExplorerGitViewState>).selectedPath),
      diffViewMode: (git as Partial<ExplorerGitViewState>).diffViewMode === 'split' ? 'split' : 'unified',
      showFullDiff: Boolean((git as Partial<ExplorerGitViewState>).showFullDiff),
    },
  }
}

function sanitizePaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  return Array.from(new Set(paths.filter(isString).map(item => item.trim()).filter(Boolean))).slice(-MAX_EXPANDED_PATHS)
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sanitizeTreeSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1200, Math.max(120, Math.round(value)))
    : fallback
}

function normalizeRoot(root?: string): string {
  return (root || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function emptyStore(): ExplorerStateStore {
  return { version: 1, recentRoots: [], roots: {} }
}
