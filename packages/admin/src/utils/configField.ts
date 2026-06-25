// 与 sbot.plugin 的 ConfigField.ts 保持同构的字段显示条件 DSL（前端侧镜像，admin 不跨依赖 sbot.plugin）。
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

/** 求值单个显示条件。配置值取自 config[field]。 */
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
