import { ref, computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast, useConfirm } from 'sbot-ui'
import { apiFetch } from '@/shared/api'

export type TodoStatus   = 'pending' | 'done'
export type TodoPriority = 'low' | 'normal' | 'high'
export type StatusFilter = TodoStatus | 'all'

export interface Todo {
  key?: string
  id: number
  profileId: number
  sessionName: string
  channelId: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  deadline: string | null
  doneAt: string | null
  createdAt: string
}

export type ConfirmFn = (message: string, options?: { danger?: boolean }) => boolean | Promise<boolean>

export const adminConfirm: ConfirmFn = (msg, options) => {
  const { confirm } = useConfirm()
  return confirm(msg, options)
}

export function priorityVariant(p: TodoPriority): 'danger' | 'info' | 'neutral' {
  if (p === 'high') return 'danger'
  if (p === 'low')  return 'neutral'
  return 'info'
}

export function statusVariant(s: TodoStatus): 'success' | 'info' {
  return s === 'done' ? 'success' : 'info'
}

export function priorityRank(p: TodoPriority): number {
  if (p === 'high')   return 0
  if (p === 'normal') return 1
  return 2
}

export function isOverdue(t: Todo, now = Date.now()): boolean {
  if (t.status !== 'pending' || !t.deadline) return false
  const d = Date.parse(t.deadline)
  return Number.isFinite(d) && d < now
}

export function sortTodos(rows: Todo[]): Todo[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
    const pr = priorityRank(a.priority) - priorityRank(b.priority)
    if (pr !== 0) return pr
    return (a.createdAt || '').localeCompare(b.createdAt || '')
  })
}

export interface UseTodosOptions {
  // Build the query string fragment for `/api/todos?...`. Return null to skip
  // loading (e.g. modal not bound to a session yet).
  buildQuery: () => string | null
  confirm?: ConfirmFn
}

export function useTodos(opts: UseTodosOptions) {
  const { t } = useI18n()
  const { show } = useToast()
  const confirm = opts.confirm ?? adminConfirm

  const todos        = ref<Todo[]>([]) as Ref<Todo[]>
  const loading      = ref(false)
  const statusFilter = ref<StatusFilter>('pending')

  const sortedTodos  = computed(() => sortTodos(todos.value))
  const pendingCount = computed(() => todos.value.filter(x => x.status === 'pending').length)
  const doneCount    = computed(() => todos.value.filter(x => x.status === 'done').length)
  const overdueCount = computed(() => {
    const now = Date.now()
    return todos.value.reduce((n, x) => n + (isOverdue(x, now) ? 1 : 0), 0)
  })

  async function load() {
    const q = opts.buildQuery()
    if (q === null) return  // explicit skip (e.g. modal not bound yet); '' means list all
    loading.value = true
    try {
      const sep = q ? '&' : ''
      const res = await apiFetch(`/api/todos?${q}${sep}status=${statusFilter.value}`)
      todos.value = res.data || []
    } catch (e: any) {
      show(e?.message || String(e), 'error')
    } finally {
      loading.value = false
    }
  }

  async function markDone(row: Todo) {
    if (!await confirm(t('todo.confirm_done', { id: row.id }))) return
    try {
      await apiFetch(`/api/todos/${row.profileId}/${row.id}`, 'PATCH')
      show(t('common.saved'))
      await load()
    } catch (e: any) {
      show(e?.message || String(e), 'error')
    }
  }

  async function remove(row: Todo) {
    if (!await confirm(t('todo.confirm_delete', { id: row.id }), { danger: true })) return
    try {
      await apiFetch(`/api/todos/${row.profileId}/${row.id}`, 'DELETE')
      show(t('common.deleted'))
      await load()
    } catch (e: any) {
      show(e?.message || String(e), 'error')
    }
  }

  function priorityLabel(p: TodoPriority): string {
    return t(`todo.priority_${p}`)
  }

  function statusLabel(s: TodoStatus): string {
    return t(`todo.status_${s}`)
  }

  function formatTime(ts: string | null): string {
    if (!ts) return t('todo.no_deadline')
    return new Date(ts).toLocaleString('zh-CN')
  }

  return {
    todos,
    loading,
    statusFilter,
    sortedTodos,
    pendingCount,
    doneCount,
    overdueCount,
    load,
    markDone,
    remove,
    priorityLabel,
    statusLabel,
    formatTime,
  }
}
