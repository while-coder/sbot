import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useConfirm, useToast } from 'sbot-ui'

export type AgendaStatus = 'pending' | 'done' | 'cancelled'
export type AgendaPriority = 'low' | 'normal' | 'high'
export type AgendaCategory = 'todo' | 'reminder' | 'routine' | 'automation'
export type AgendaViewFilter = 'todo' | 'upcoming' | 'routine' | 'automation' | 'all'
export type AgendaStatusFilter = AgendaStatus | 'all'

export interface AgendaTrigger {
  id: number
  itemId: number
  kind: 'absolute' | 'interval' | 'cron'
  expr: string
  timezone: string | null
  action: 'notify' | 'send' | 'invoke'
  message: string | null
  channelHint: number
  enabled: boolean
  fireCount: number
  maxFires: number
  lastFiredAt: number | null
  nextFireAt: number | null
  skipNextFireAt: number | null
  skipFireCount: number | null
  createdAt: number
}

export interface AgendaItem {
  id: number
  /** 服务端按模板分组返回；标识此 item 属于哪个 agenda 模板 */
  agendaId: string
  content: string
  status: AgendaStatus
  priority: AgendaPriority
  category: AgendaCategory
  completionMode: 'none' | 'item' | 'occurrence'
  dueAt: number | null
  source: 'user' | 'tool' | 'sync' | 'rule'
  createdAt: number
  updatedAt: number
  doneAt: number | null
  triggers: AgendaTrigger[]
}

export interface UseAgendasOptions {
  buildQuery: () => string | null
  limit?: number
}

export function firstNextFire(row: AgendaItem): number | null {
  const values = row.triggers
    .filter(t => t.enabled && t.nextFireAt)
    .map(t => t.nextFireAt as number)
    .sort((a, b) => a - b)
  return values[0] ?? null
}

export function isOverdue(row: AgendaItem, now = Date.now()): boolean {
  return row.status === 'pending' && row.dueAt != null && row.dueAt < now
}

export function priorityRank(p: AgendaPriority): number {
  if (p === 'high') return 0
  if (p === 'normal') return 1
  return 2
}

export function sortAgendas(rows: AgendaItem[]): AgendaItem[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
    const an = firstNextFire(a) ?? a.dueAt ?? a.createdAt
    const bn = firstNextFire(b) ?? b.dueAt ?? b.createdAt
    if (an !== bn) return an - bn
    return priorityRank(a.priority) - priorityRank(b.priority)
  })
}

export function useAgendas(opts: UseAgendasOptions) {
  const { t } = useI18n()
  const { show } = useToast()
  const { confirm } = useConfirm()

  const agendas = ref<AgendaItem[]>([])
  const loading = ref(false)
  const statusFilter = ref<AgendaStatusFilter>('pending')
  const viewFilter = ref<AgendaViewFilter>('all')
  const sortedAgendas = computed(() => sortAgendas(agendas.value))
  const pendingCount = computed(() => agendas.value.filter(x => x.status === 'pending').length)
  const dueCount = computed(() => agendas.value.filter(x => isOverdue(x)).length)
  const triggerCount = computed(() => agendas.value.reduce((n, x) => n + x.triggers.filter(t => t.enabled).length, 0))

  async function load() {
    const base = opts.buildQuery()
    if (base == null) {
      agendas.value = []
      return
    }
    loading.value = true
    try {
      const parts = [
        base,
        `status=${encodeURIComponent(statusFilter.value)}`,
        `view=${encodeURIComponent(viewFilter.value)}`,
        `limit=${encodeURIComponent(String(opts.limit ?? 500))}`,
      ].filter(Boolean)
      const res = await apiFetch(`/api/agendas?${parts.join('&')}`)
      agendas.value = res.data || []
    } catch (e: any) {
      show(e.message, 'error')
    } finally {
      loading.value = false
    }
  }

  async function complete(row: AgendaItem) {
    if (!await confirm(t('agenda.confirm_complete', { id: row.id }))) return
    try {
      await apiFetch(`/api/agendas/${row.id}/complete`, 'POST', { agendaId: row.agendaId })
      show(t('common.saved'))
      await load()
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  async function cancel(row: AgendaItem) {
    if (!await confirm(t('agenda.confirm_cancel', { id: row.id }), { danger: true })) return
    try {
      await apiFetch(`/api/agendas/${row.id}/cancel`, 'POST', { agendaId: row.agendaId })
      show(t('common.saved'))
      await load()
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  async function skipNext(row: AgendaItem) {
    try {
      await apiFetch(`/api/agendas/${row.id}/skip-next`, 'POST', { agendaId: row.agendaId })
      show(t('agenda.skipped_next'))
      await load()
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  async function remove(row: AgendaItem) {
    if (!await confirm(t('agenda.confirm_delete', { id: row.id }), { danger: true })) return
    try {
      await apiFetch(`/api/agendas/${row.id}?agendaId=${encodeURIComponent(row.agendaId)}`, 'DELETE')
      show(t('common.deleted'))
      await load()
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  return {
    agendas,
    loading,
    statusFilter,
    viewFilter,
    sortedAgendas,
    pendingCount,
    dueCount,
    triggerCount,
    load,
    complete,
    cancel,
    skipNext,
    remove,
  }
}
