// plugin.schema 的 ConfigField.showWhen DSL 的前端侧镜像（与 admin utils/configField.ts 同构）。
type FieldValue = string | number | boolean

/** 单字段条件：针对 field 给出一种匹配方式；只填 field 表示「该字段有值」。 */
export interface FieldCondition {
  field: string
  eq?: FieldValue
  ne?: FieldValue
  in?: FieldValue[]
  notIn?: FieldValue[]
}

/** 字段显示条件：单字段条件，或 and / or / not 逻辑组合，可嵌套。 */
export type ShowWhen =
  | FieldCondition
  | { and: ShowWhen[] }
  | { or: ShowWhen[] }
  | { not: ShowWhen }

function evalShowWhen(cond: ShowWhen, config: Record<string, any>): boolean {
  if ('and' in cond) return cond.and.every(c => evalShowWhen(c, config))
  if ('or' in cond) return cond.or.some(c => evalShowWhen(c, config))
  if ('not' in cond) return !evalShowWhen(cond.not, config)
  const actual = config?.[cond.field]
  if ('eq' in cond) return actual === cond.eq
  if ('ne' in cond) return actual !== cond.ne
  if ('in' in cond) return (cond.in ?? []).includes(actual)
  if ('notIn' in cond) return !(cond.notIn ?? []).includes(actual)
  // 仅给了 field：视为「有值」
  return actual !== undefined && actual !== null && actual !== '' && actual !== false
}

/** 依据 field.showWhen 与当前表单值判断该字段是否应显示。无 showWhen → 始终显示。 */
export function isConfigFieldVisible(
  field: { showWhen?: ShowWhen },
  config: Record<string, any> | undefined | null,
): boolean {
  return field.showWhen ? evalShowWhen(field.showWhen, config ?? {}) : true
}

/** ConfigField（与 plugin.schema 保持同构；qrcode 字段在桌面端退化为文本粘贴） */
export interface ConfigField {
  label: string
  type: 'string' | 'textarea' | 'password' | 'boolean' | 'number' | 'select' | 'qrcode'
  required?: boolean
  description?: string
  default?: string | boolean | number
  options?: Array<{ label: string; value: string }>
  showWhen?: ShowWhen
}

/** 按 schema 过滤出当前可见且有效的 config 键值（保存前剔除隐藏/空值字段） */
export function pickVisibleConfig(
  schema: Record<string, ConfigField>,
  config: Record<string, any> | undefined | null,
): Record<string, any> {
  const result: Record<string, any> = {}
  if (!config) return result
  for (const [key, field] of Object.entries(schema)) {
    if (!isConfigFieldVisible(field, config)) continue
    const value = config[key]
    if (field.type === 'qrcode') {
      // 二维码字段：登录流程产生的对象结果原样保留，未登录的空值丢弃
      if (value && typeof value === 'object') result[key] = value
      continue
    }
    if (value !== '' && value !== undefined && value !== null) {
      result[key] = typeof value === 'string' ? value.trim() : value
    }
  }
  return result
}
