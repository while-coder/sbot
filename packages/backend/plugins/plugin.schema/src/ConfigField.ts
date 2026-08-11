/**
 * 插件配置项描述。供 admin 端依据 schema 自动渲染配置表单，
 * channel 插件与 wiki 插件共用同一套字段类型。
 */
export enum ConfigFieldType {
  String = 'string',
  /** 多行文本（textarea）。适合大段内容，如 Service Account JSON 凭据。 */
  Textarea = 'textarea',
  Password = 'password',
  Boolean = 'boolean',
  Number = 'number',
  Select = 'select',
  /** Renders a button → QR code image → waits for scan result. */
  QRCode = 'qrcode',
}

export type ConfigFieldValue = string | number | boolean;

/**
 * 单字段条件：针对 `field` 字段给出一种匹配方式。
 * 只填 `field` 不带操作符时，表示「该字段有值」（非空/非 undefined/非 false）。
 */
export interface FieldCondition {
  /** 同 schema 中另一字段名。 */
  field: string;
  /** 等于。 */
  eq?: ConfigFieldValue;
  /** 不等于。 */
  ne?: ConfigFieldValue;
  /** 取值在集合内。 */
  in?: ConfigFieldValue[];
  /** 取值不在集合内。 */
  notIn?: ConfigFieldValue[];
}

/**
 * 字段显示条件：单字段条件，或 and / or / not 逻辑组合，可任意嵌套。
 * 例：
 * - `{ field: 'authMethod', eq: 'oauth' }` —— authMethod 为 oauth 时显示。
 * - `{ field: 'authMethod', ne: 'oauth' }` —— authMethod 不为 oauth 时显示。
 * - `{ or: [{ field: 'name1', eq: 1 }, { field: 'name2', eq: 1 }] }` —— 二者任一为 1。
 */
export type ShowWhen =
  | FieldCondition
  | { and: ShowWhen[] }
  | { or: ShowWhen[] }
  | { not: ShowWhen };

export interface ConfigField {
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  description?: string;
  default?: string | boolean | number;
  /** only for type: 'select' */
  options?: Array<{ label: string; value: string }>;
  /** 显示条件：满足时才渲染本字段。见 {@link ShowWhen}。缺省 → 始终显示。 */
  showWhen?: ShowWhen;
}

/** 求值单个显示条件。配置值取自 `config[field]`。 */
export function evalShowWhen(cond: ShowWhen, config: Record<string, any>): boolean {
  if ("and" in cond) return cond.and.every((c) => evalShowWhen(c, config));
  if ("or" in cond) return cond.or.some((c) => evalShowWhen(c, config));
  if ("not" in cond) return !evalShowWhen(cond.not, config);
  const actual = config?.[cond.field];
  if ("eq" in cond) return actual === cond.eq;
  if ("ne" in cond) return actual !== cond.ne;
  if ("in" in cond) return (cond.in ?? []).includes(actual);
  if ("notIn" in cond) return !(cond.notIn ?? []).includes(actual);
  // 仅给了 field：视为「有值」
  return actual !== undefined && actual !== null && actual !== "" && actual !== false;
}

/** 依据 field.showWhen 与当前表单值判断该字段是否应显示。无 showWhen → 始终显示。 */
export function isConfigFieldVisible(
  field: { showWhen?: ShowWhen },
  config: Record<string, any> | undefined | null,
): boolean {
  return field.showWhen ? evalShowWhen(field.showWhen, config ?? {}) : true;
}
