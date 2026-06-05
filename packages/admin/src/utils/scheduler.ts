// packages/admin/src/utils/scheduler.ts
import type { ComposerTranslation } from 'vue-i18n'

export interface SchedulerRow {
  id: number
  expr: string
  message: string
  channelSessionId: number
  profileId: number
  aiProcess: boolean
  enabled: boolean
  lastRun: number | null
  nextRun: number | null
  runCount: number
  maxRuns: number
  createdAt: number
}

export type UIType = 'daily' | 'weekly' | 'monthly' | 'once' | 'interval' | 'hourly' | 'custom'

export const TYPE_VARIANT: Record<UIType, 'info' | 'accent' | 'success' | 'warning' | 'neutral'> = {
  interval: 'info',
  hourly:   'accent',
  daily:    'success',
  weekly:   'warning',
  monthly:  'warning',
  once:     'accent',
  custom:   'neutral',
}

interface CronFields { s: string; m: string; h: string; dom: string; mon: string; dow: string }

function parseCron(expr: string): CronFields | null {
  const p = expr.trim().split(/\s+/)
  if (p.length === 6) return { s: p[0], m: p[1], h: p[2], dom: p[3], mon: p[4], dow: p[5] }
  if (p.length === 5) return { s: '0', m: p[0], h: p[1], dom: p[2], mon: p[3], dow: p[4] }
  return null
}

export function detectUIType(expr: string): UIType {
  const f = parseCron(expr)
  if (!f) return 'custom'
  const { s, m, h, dom, mon, dow } = f
  const allRest = dom === '*' && mon === '*' && dow === '*'
  if (/^\*\/\d+$/.test(s) && m === '*' && h === '*' && allRest) return 'interval'
  if (s === '0' && /^\*\/\d+$/.test(m) && h === '*' && allRest)  return 'interval'
  if (s === '0' && m === '0' && /^\*\/\d+$/.test(h) && allRest)  return 'interval'
  if (/^\d+$/.test(s) && /^\d+$/.test(m) && h === '*' && allRest) return 'hourly'
  if (/^\d+$/.test(s) && /^\d+$/.test(m) && /^\d+$/.test(h)) {
    if (dom === '*' && mon === '*' && /^\d$/.test(dow))                              return 'weekly'
    if (/^\d+$/.test(dom) && /^\d+$/.test(mon) && dow === '*')                       return 'once'
    if (/^\d+$/.test(dom) && mon === '*' && dow === '*')                             return 'monthly'
    if (allRest)                                                                      return 'daily'
  }
  return 'custom'
}

export function describeExpr(expr: string, t: ComposerTranslation): string {
  const f = parseCron(expr)
  if (!f) return expr
  const { s, m, h, dom, mon, dow } = f
  const pad = (v: string) => String(parseInt(v)).padStart(2, '0')
  const allRest = dom === '*' && mon === '*' && dow === '*'

  if (/^\*\/\d+$/.test(s) && m === '*' && h === '*' && allRest)
    return t('scheduler.cron_every_n_seconds', { n: s.slice(2) })
  if (s === '0' && /^\*\/\d+$/.test(m) && h === '*' && allRest)
    return t('scheduler.cron_every_n_minutes', { n: m.slice(2) })
  if (s === '0' && m === '0' && /^\*\/\d+$/.test(h) && allRest)
    return t('scheduler.cron_every_n_hours', { n: h.slice(2) })

  if (/^\d+$/.test(s) && /^\d+$/.test(m) && h === '*' && allRest) {
    if (s === '0' && m === '0') return t('scheduler.cron_hourly')
    if (s === '0')              return t('scheduler.cron_hourly_at', { minute: pad(m) })
    return t('scheduler.cron_hourly_at_sec', { minute: pad(m), second: pad(s) })
  }

  if (/^\d+$/.test(s) && /^\d+$/.test(m) && /^\d+$/.test(h)) {
    const time = s === '0'
      ? `${pad(h)}:${pad(m)}`
      : `${pad(h)}:${pad(m)}:${pad(s)}`
    if (dom === '*' && mon === '*' && /^\d$/.test(dow))
      return t('scheduler.cron_weekly', { day: t(`scheduler.weekday_${dow}`), time })
    if (/^\d+$/.test(dom) && /^\d+$/.test(mon) && dow === '*')
      return t('scheduler.cron_once', { month: parseInt(mon), day: parseInt(dom), time })
    if (/^\d+$/.test(dom) && mon === '*' && dow === '*')
      return t('scheduler.cron_monthly', { day: dom, time })
    if (allRest)
      return t('scheduler.cron_daily', { time })
  }

  return expr
}
