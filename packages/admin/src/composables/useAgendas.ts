import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/shared/api'
import { useConfirm, useToast } from 'sbot-ui'

export type AgendaStatus = 'pending' | 'done' | 'cancelled'
export type AgendaPriority = 'low' | 'normal' | 'high'
export type AgendaSource = 'user' | 'tool' | 'sync' | 'rule'
export type AgendaTriggerKind = 'absolute' | 'interval' | 'cron'
export type AgendaTriggerAction = 'notify' | 'notify_and_record' | 'invoke'
export type AgendaOccurrenceStatus = 'pending' | 'done' | 'missed'
export type AgendaStatusFilter = AgendaStatus | 'all'

export interface AgendaItem {
  id: number
  content: string
  status: AgendaStatus
  priority: AgendaPriority
  requiresCheckIn: boolean
  dueAt: number | null
  source: AgendaSource
  createdAt: number
  updatedAt: number
  doneAt: number | null
}

export interface AgendaTrigger {
  id: number
  itemId: number
  kind: AgendaTriggerKind
  expr: string
  action: AgendaTriggerAction
  message: string | null
  channelSessionId: number
  enabled: boolean
  fireCount: number
  maxFires: number
  lastFiredAt: number | null
  nextFireAt: number | null
  createdAt: number
}

export interface AgendaOccurrence {
  id: number
  itemId: number
  scheduledAt: number
  status: AgendaOccurrenceStatus
  doneAt: number | null
}

/** 列表行：服务端 AgendaRecord + 所属模板 id。 */
export interface AgendaRow {
  item: AgendaItem
  triggers: AgendaTrigger[]
  occurrences: AgendaOccurrence[]
  agendaId: string
}

export interface UseAgendasOptions {
  buildQuery: () => string | null
  limit?: number
}

export function firstNextFire(row: AgendaRow): number | null {
  const values = row.triggers
    .filter(t => t.enabled && t.nextFireAt)
    .map(t => t.nextFireAt as number)
    .sort((a, b) => a - b)
  return values[0] ?? null
}

export function isOverdue(row: AgendaRow, now = Date.now()): boolean {
  const item = row.item
  return item.status === 'pending' && item.dueAt != null && item.dueAt < now
}

export function priorityRank(p: AgendaPriority): number {
  if (p === 'high') return 0
  if (p === 'normal') return 1
  return 2
}

export function sortAgendas(rows: AgendaRow[]): AgendaRow[] {
  return [...rows].sort((a, b) => {
    if (a.item.status !== b.item.status) return a.item.status === 'pending' ? -1 : 1
    const an = firstNextFire(a) ?? a.item.dueAt ?? a.item.createdAt
    const bn = firstNextFire(b) ?? b.item.dueAt ?? b.item.createdAt
    if (an !== bn) return an - bn
    return priorityRank(a.item.priority) - priorityRank(b.item.priority)
  })
}

export function useAgendas(opts: UseAgendasOptions) {
  const { t } = useI18n()
  const { show } = useToast()
  const { confirm } = useConfirm()

  const agendas = ref<AgendaRow[]>([])
  const loading = ref(false)
  const statusFilter = ref<AgendaStatusFilter>('pending')
  const sortedAgendas = computed(() => sortAgendas(agendas.value))
  const pendingCount = computed(() => agendas.value.filter(x => x.item.status === 'pending').length)
  const dueCount = computed(() => agendas.value.filter(x => isOverdue(x)).length)
  const cancelledCount = computed(() => agendas.value.filter(x => x.item.status === 'cancelled').length)
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

  async function complete(row: AgendaRow) {
    if (!await confirm(t('agenda.confirm_complete', { id: row.item.id }))) return
    try {
      await apiFetch(`/api/agendas/${row.item.id}/complete`, 'POST', { agendaId: row.agendaId })
      show(t('common.saved'))
      await load()
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  async function cancel(row: AgendaRow) {
    if (!await confirm(t('agenda.confirm_cancel', { id: row.item.id }), { danger: true })) return
    try {
      await apiFetch(`/api/agendas/${row.item.id}/cancel`, 'POST', { agendaId: row.agendaId })
      show(t('common.saved'))
      await load()
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  async function update(payload: { row: AgendaRow; patch: Record<string, unknown> }) {
    const { row, patch } = payload
    try {
      await apiFetch(`/api/agendas/${row.item.id}`, 'PATCH', { agendaId: row.agendaId, ...patch })
      show(t('common.saved'))
      await load()
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  async function fireTrigger(payload: { row: AgendaRow; trigger: AgendaTrigger }) {
    const { row, trigger } = payload
    if (!await confirm(t('agenda.confirm_fire_trigger', { id: trigger.id }))) return
    try {
      const res = await apiFetch(`/api/agendas/triggers/${trigger.id}/fire`, 'POST', { agendaId: row.agendaId })
      if (res.data?.ok) show(t('agenda.fire_trigger_ok'))
      else show(t('agenda.fire_trigger_no_delivery'), 'error')
    } catch (e: any) {
      show(e.message, 'error')
    }
  }

  async function remove(row: AgendaRow) {
    if (!await confirm(t('agenda.confirm_delete', { id: row.item.id }), { danger: true })) return
    try {
      await apiFetch(`/api/agendas/${row.item.id}?agendaId=${encodeURIComponent(row.agendaId)}`, 'DELETE')
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
    sortedAgendas,
    pendingCount,
    dueCount,
    cancelledCount,
    triggerCount,
    load,
    complete,
    cancel,
    remove,
    update,
    fireTrigger,
  }
}
