import type { AgendaTrigger, AgendaTriggerAction, AgendaTriggerKind } from '@/composables/useAgendas'

export type TriggerUnit = 'minute' | 'hour' | 'day' | 'week'

/** 触发器编辑用的草稿模型：把 trigger 的各类 expr 拆成 UI 友好的字段。 */
export interface TriggerDraft {
  kind: AgendaTriggerKind
  // absolute
  at: string
  // interval
  amount: number
  unit: TriggerUnit
  // cron
  expr: string
  // shared schedule
  startAt: string
  count: string
  // shared delivery
  action: AgendaTriggerAction
  message: string
  /** 投递目标频道会话 db id；0 = 自动解析归属会话。 */
  channelSessionId: number
}

const UNIT_MS: Record<TriggerUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

export function tsToLocalInput(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function localInputToIso(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function reverseInterval(ms: number): { amount: number; unit: TriggerUnit } {
  for (const unit of ['week', 'day', 'hour', 'minute'] as TriggerUnit[]) {
    const u = UNIT_MS[unit]
    if (ms >= u && ms % u === 0) return { amount: Math.floor(ms / u), unit }
  }
  // 退化：保留分钟数（向上取整 1）
  return { amount: Math.max(1, Math.round(ms / UNIT_MS.minute)), unit: 'minute' }
}

export function emptyDraft(): TriggerDraft {
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000)
  return {
    kind: 'absolute',
    at: tsToLocalInput(inOneHour.getTime()),
    amount: 1,
    unit: 'day',
    expr: '',
    startAt: '',
    count: '',
    action: 'notify',
    message: '',
    channelSessionId: 0,
  }
}

export function triggerToDraft(trigger: AgendaTrigger): TriggerDraft {
  const base: TriggerDraft = {
    kind: trigger.kind,
    at: '',
    amount: 1,
    unit: 'day',
    expr: '',
    startAt: '',
    count: trigger.maxFires > 0 ? String(trigger.maxFires) : '',
    action: trigger.action,
    message: trigger.message ?? '',
    channelSessionId: trigger.channelSessionId > 0 ? trigger.channelSessionId : 0,
  }
  if (trigger.kind === 'absolute') {
    base.at = tsToLocalInput(new Date(trigger.expr).getTime())
  } else if (trigger.kind === 'interval') {
    const ms = Number(trigger.expr)
    if (Number.isFinite(ms) && ms > 0) {
      const { amount, unit } = reverseInterval(ms)
      base.amount = amount
      base.unit = unit
    }
  } else if (trigger.kind === 'cron') {
    base.expr = trigger.expr
  }
  return base
}

export function draftToSpec(d: TriggerDraft): Record<string, unknown> | null {
  // message 必填：与后端 trigger 端点的校验对齐（留空会被后端 400 拒绝，且不再回退到 item.content）。
  const message = d.message.trim()
  if (!message) return null
  const base: Record<string, unknown> = {
    kind: d.kind,
    action: d.action,
    message,
    channelSessionId: d.channelSessionId > 0 ? d.channelSessionId : 0,
  }
  if (d.kind === 'absolute') {
    const iso = localInputToIso(d.at)
    if (!iso) return null
    base.at = iso
    return base
  }
  const startIso = d.startAt ? localInputToIso(d.startAt) : null
  if (d.startAt && !startIso) return null
  if (startIso) base.startAt = startIso
  const count = d.count.trim() ? Number(d.count) : null
  if (count != null) {
    if (!Number.isFinite(count) || count <= 0) return null
    base.count = Math.floor(count)
  }
  if (d.kind === 'interval') {
    const amount = Number(d.amount)
    if (!Number.isFinite(amount) || amount <= 0) return null
    base.every = { amount: Math.floor(amount), unit: d.unit }
    return base
  }
  if (d.kind === 'cron') {
    const expr = d.expr.trim()
    if (!expr) return null
    base.expr = expr
    return base
  }
  return null
}
