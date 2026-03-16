// packages/website/src/utils/mcpSchema.ts
import type { McpEntry } from '@/types'

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatParamType(s: any): string {
  if (!s) return 'any'
  if (Array.isArray(s.type)) {
    const nonNull = s.type.filter((t: string) => t !== 'null')
    const base = nonNull.length === 1 ? nonNull[0] : nonNull.join(' | ')
    return s.type.includes('null') ? base + '?' : base
  }
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (s.enum) return s.enum.map((v: any) => JSON.stringify(v)).join(' | ')
  if (s.type === 'array') {
    if (s.prefixItems) return '[' + s.prefixItems.map(formatParamType).join(', ') + ']'
    if (s.items) return formatParamType(s.items) + '[]'
    return 'any[]'
  }
  if (s.type === 'object') {
    if (s.additionalProperties && typeof s.additionalProperties === 'object')
      return 'Record<string, ' + formatParamType(s.additionalProperties) + '>'
    return 'object'
  }
  if (s.anyOf || s.oneOf) {
    const variants = (s.anyOf || s.oneOf)
    const nonNull = variants.filter((v: any) => v.type !== 'null')
    const base = (nonNull.length ? nonNull : variants).map(formatParamType).join(' | ')
    return variants.some((v: any) => v.type === 'null') ? base + '?' : base
  }
  if (s.allOf) return s.allOf.map(formatParamType).join(' & ')
  if (s.$ref) { const p = s.$ref.split('/'); return p[p.length - 1] }
  if (s.type) return s.type
  return 'any'
}

export function renderSchemaChildren(s: any): string {
  if (!s) return ''
  const nest = (inner: string) =>
    `<div style="margin-left:14px;margin-top:4px;border-left:2px solid #f1f5f9;padding-left:10px">${inner}</div>`
  if ((s.type === 'object' || !s.type) && s.properties) {
    const req = new Set(s.required || [])
    return nest(
      Object.entries(s.properties)
        .map(([k, v]) => renderParamRow(k, v, req.has(k) && (v as any).default === undefined))
        .join('')
    )
  }
  if (s.type === 'object' && s.additionalProperties && typeof s.additionalProperties === 'object') {
    return `<div class="param-desc">值类型: ${esc(formatParamType(s.additionalProperties))}</div>` +
      renderSchemaChildren(s.additionalProperties)
  }
  if (s.type === 'array') {
    if (s.prefixItems)
      return nest(s.prefixItems.map((item: any, i: number) => renderParamRow(`[${i}]`, item, false)).join(''))
    if (s.items)
      return `<div class="param-desc">元素类型: ${esc(formatParamType(s.items))}</div>` +
        (s.items.properties || s.items.anyOf || s.items.allOf ? nest(renderSchemaChildren(s.items)) : '')
  }
  if (s.anyOf || s.oneOf) {
    const variants = (s.anyOf || s.oneOf).filter((v: any) => v.type !== 'null')
    return variants.map((v: any, i: number) => {
      const label = variants.length > 1
        ? `<div class="param-desc" style="font-weight:600;margin-top:4px">联合类型 ${i + 1}: ${esc(formatParamType(v))}</div>`
        : ''
      return label + renderSchemaChildren(v)
    }).join('')
  }
  if (s.allOf) return s.allOf.map(renderSchemaChildren).join('')
  return ''
}

export function renderParamRow(name: string, prop: any, isRequired: boolean): string {
  let html = '<div class="tool-param">'
  html += `<div><span class="param-name">${esc(name)}</span>`
  html += `<span class="param-type">${esc(formatParamType(prop))}</span>`
  if (isRequired) html += '<span class="param-required">*必填</span>'
  html += '</div>'
  if (prop.description) html += `<div class="param-desc">${esc(prop.description)}</div>`
  if (prop.const !== undefined) html += `<div class="param-enum">固定值: ${esc(JSON.stringify(prop.const))}</div>`
  if (prop.enum) html += `<div class="param-enum">可选值: ${prop.enum.map((v: any) => esc(JSON.stringify(v))).join(' | ')}</div>`
  if (prop.default !== undefined) html += `<div class="param-default">默认值: ${esc(JSON.stringify(prop.default))}</div>`
  html += renderSchemaChildren(prop)
  html += '</div>'
  return html
}

export function renderToolParams(schema: any): string {
  if (!schema) return '<div class="tool-no-params">无参数</div>'
  if (schema.allOf)
    return schema.allOf.map(renderToolParams).join('') || '<div class="tool-no-params">无参数</div>'
  if (schema.anyOf || schema.oneOf) {
    const variants = (schema.anyOf || schema.oneOf).filter((v: any) => v.type !== 'null')
    if (variants.length === 1) return renderToolParams(variants[0])
    return variants.map((v: any, i: number) =>
      `<div class="param-desc" style="font-weight:600">联合类型 ${i + 1}:</div>` + renderToolParams(v)
    ).join('')
  }
  if (schema.type === 'array') {
    if (schema.prefixItems)
      return schema.prefixItems.map((item: any, i: number) => renderParamRow(`[${i}]`, item, false)).join('')
    if (schema.items) return renderParamRow('items', schema.items, false)
    return '<div class="tool-no-params">any[]</div>'
  }
  if (schema.properties && Object.keys(schema.properties).length > 0) {
    const required = new Set(schema.required || [])
    return Object.entries(schema.properties)
      .map(([n, p]) => renderParamRow(n, p, required.has(n) && (p as any).default === undefined))
      .join('')
  }
  if (schema.type === 'object' && schema.additionalProperties) {
    return `<div class="tool-param"><span class="param-type">${esc(formatParamType(schema))}</span></div>`
  }
  return '<div class="tool-no-params">无参数</div>'
}

export function serverAddr(s: McpEntry): string {
  if (s.type === 'http') return s.url || '-'
  if (s.type === 'stdio') return [s.command, ...(s.args || [])].join(' ')
  return '-'
}
