# Extract Website Common Utilities Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract duplicated constants and functions from website views into two shared utility files (`utils/badges.ts` and `utils/mcpSchema.ts`), then update all consumers to import from those files.

**Architecture:** Create two focused utility modules in `packages/website/src/utils/`. `badges.ts` owns all badge styling logic (colors, style strings, hash function). `mcpSchema.ts` owns MCP tool schema rendering (HTML generation helpers). Five view files currently duplicate this logic and will be updated to import from the new modules.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Vite (path alias `@/` → `src/`)

---

## Chunk 1: Create utility files

### Task 1: Create `src/utils/badges.ts`

**Files:**
- Create: `packages/website/src/utils/badges.ts`

- [ ] **Step 1: Create the file with all exports**

```typescript
// packages/website/src/utils/badges.ts

/** Color pool used for source-keyed badge coloring (hash-assigned). */
export const SOURCE_COLORS = [
  { bg: '#e0e7ff', color: '#4f46e5' },
  { bg: '#dcfce7', color: '#16a34a' },
  { bg: '#fef9c3', color: '#a16207' },
  { bg: '#fce7f3', color: '#be185d' },
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#fff7ed', color: '#c2410c' },
  { bg: '#f3e8ff', color: '#7c3aed' },
  { bg: '#ecfeff', color: '#0e7490' },
]

/** Returns an inline style string for a source badge, using a hash of the source string. */
export function sourceBadgeStyle(source: string | undefined): string {
  if (!source) return 'background:#f0efed;color:#6b6b6b'
  let hash = 0
  for (const c of source) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  const { bg, color } = SOURCE_COLORS[hash % SOURCE_COLORS.length]
  return `background:${bg};color:${color}`
}

// ── Fixed badge style constants ───────────────────────────────────
// 8px-radius variants (used in list/table rows)
export const BADGE_BUILTIN  = 'background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600'
export const BADGE_GLOBAL   = 'background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600'
export const BADGE_PRIVATE  = 'background:#f0efed;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600'

// 10px-radius pill variants (used in card/pill context)
export const BADGE_CLAWHUB       = 'background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600'
export const BADGE_GLOBAL_PILL   = 'background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600'
export const BADGE_PRIVATE_PILL  = 'background:#f0efed;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600'

// Other status badges
export const BADGE_INSTALLED = 'background:#dcfce7;color:#16a34a;font-size:10px;padding:2px 8px;border-radius:6px;font-weight:600'
```

- [ ] **Step 2: Verify file compiles (no TypeScript errors)**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: No errors related to `utils/badges.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/website/src/utils/badges.ts
git commit -m "feat(website): add utils/badges.ts with SOURCE_COLORS, sourceBadgeStyle, badge constants"
```

---

### Task 2: Create `src/utils/mcpSchema.ts`

**Files:**
- Create: `packages/website/src/utils/mcpSchema.ts`
- Reference: `packages/website/src/views/McpView.vue:254-362` (canonical, well-formatted version)

The well-formatted version from `McpView.vue` is used as the source of truth (it's identical in logic to `AgentMcpModal.vue` but formatted more readably).

- [ ] **Step 1: Create the file**

```typescript
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
```

- [ ] **Step 2: Verify file compiles**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: No errors related to `utils/mcpSchema.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/website/src/utils/mcpSchema.ts
git commit -m "feat(website): add utils/mcpSchema.ts with MCP schema rendering helpers"
```

---

## Chunk 2: Update view files

### Task 3: Update `AgentSkillsModal.vue`

**Files:**
- Modify: `packages/website/src/views/agents/AgentSkillsModal.vue:1-27` (remove local declarations, add imports)
- Modify: `packages/website/src/views/agents/AgentSkillsModal.vue` template (replace hardcoded badge styles)

**What to change:**
1. Remove lines 10–26 (`SOURCE_COLORS` constant + `sourceBadgeStyle` function)
2. Add import at top of `<script setup>`: `import { sourceBadgeStyle, BADGE_CLAWHUB } from '@/utils/badges'`
3. In template lines ~387 and ~420: replace hardcoded `style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600"` with `:style="BADGE_CLAWHUB"`

- [ ] **Step 1: Remove local SOURCE_COLORS and sourceBadgeStyle (lines 10–26)**

In `packages/website/src/views/agents/AgentSkillsModal.vue`, delete:
```typescript
const SOURCE_COLORS = [
  { bg: '#e0e7ff', color: '#4f46e5' },
  { bg: '#dcfce7', color: '#16a34a' },
  { bg: '#fef9c3', color: '#a16207' },
  { bg: '#fce7f3', color: '#be185d' },
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#fff7ed', color: '#c2410c' },
  { bg: '#f3e8ff', color: '#7c3aed' },
  { bg: '#ecfeff', color: '#0e7490' },
]
function sourceBadgeStyle(source: string | undefined) {
  if (!source) return 'background:#f0efed;color:#6b6b6b'
  let hash = 0
  for (const c of source) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  const { bg, color } = SOURCE_COLORS[hash % SOURCE_COLORS.length]
  return `background:${bg};color:${color}`
}
```

- [ ] **Step 2: Add import to script setup**

Change:
```typescript
import type { SkillItem } from '@/types'
```
To:
```typescript
import type { SkillItem } from '@/types'
import { sourceBadgeStyle, BADGE_CLAWHUB } from '@/utils/badges'
```

- [ ] **Step 3: Replace hardcoded ClawHub badge style strings in template**

Find (appears twice, ~lines 387 and 420):
```html
style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600"
```
Replace with:
```html
:style="BADGE_CLAWHUB"
```

- [ ] **Step 4: Verify build**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/views/agents/AgentSkillsModal.vue
git commit -m "refactor(website): AgentSkillsModal - import badges from utils"
```

---

### Task 4: Update `SkillsView.vue`

**Files:**
- Modify: `packages/website/src/views/SkillsView.vue:1-27` (remove local declarations, add imports)
- Modify: `packages/website/src/views/SkillsView.vue` template (replace hardcoded badge styles)

**What to change:**
1. Remove lines 10–26 (`SOURCE_COLORS` + `sourceBadgeStyle`)
2. Add import: `import { sourceBadgeStyle, BADGE_CLAWHUB, BADGE_INSTALLED } from '@/utils/badges'`
3. Replace hardcoded ClawHub badge style (~lines 383, 414): `style="background:#e0e7ff;..."` → `:style="BADGE_CLAWHUB"`
4. Replace hardcoded installed badge style (~line 387): `style="background:#dcfce7;..."` → `:style="BADGE_INSTALLED"`

- [ ] **Step 1: Remove local SOURCE_COLORS and sourceBadgeStyle (lines 10–26)**

Delete:
```typescript
const SOURCE_COLORS = [
  { bg: '#e0e7ff', color: '#4f46e5' },
  { bg: '#dcfce7', color: '#16a34a' },
  { bg: '#fef9c3', color: '#a16207' },
  { bg: '#fce7f3', color: '#be185d' },
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#fff7ed', color: '#c2410c' },
  { bg: '#f3e8ff', color: '#7c3aed' },
  { bg: '#ecfeff', color: '#0e7490' },
]
function sourceBadgeStyle(source: string | undefined) {
  if (!source) return 'background:#f0efed;color:#6b6b6b'
  let hash = 0
  for (const c of source) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  const { bg, color } = SOURCE_COLORS[hash % SOURCE_COLORS.length]
  return `background:${bg};color:${color}`
}
```

- [ ] **Step 2: Add import**

Change:
```typescript
import type { SkillItem } from '@/types'
```
To:
```typescript
import type { SkillItem } from '@/types'
import { sourceBadgeStyle, BADGE_CLAWHUB, BADGE_INSTALLED } from '@/utils/badges'
```

- [ ] **Step 3: Replace ClawHub badge style strings (×2 occurrences in template)**

Find:
```html
style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600"
```
Replace with:
```html
:style="BADGE_CLAWHUB"
```

- [ ] **Step 4: Replace installed badge style string (~line 387)**

Find:
```html
style="background:#dcfce7;color:#16a34a;font-size:10px;padding:2px 8px;border-radius:6px;font-weight:600"
```
Replace with:
```html
:style="BADGE_INSTALLED"
```

- [ ] **Step 5: Verify build**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/website/src/views/SkillsView.vue
git commit -m "refactor(website): SkillsView - import badges from utils"
```

---

### Task 5: Update `AgentDetailView.vue`

**Files:**
- Modify: `packages/website/src/views/agents/AgentDetailView.vue:16-32` (remove local declarations, add imports)
- Modify: `packages/website/src/views/agents/AgentDetailView.vue` template

**What to change:**
1. Remove lines 16–32 (`SOURCE_COLORS` + `sourceBadgeStyle`)
2. Add import: `import { sourceBadgeStyle, BADGE_PRIVATE, BADGE_CLAWHUB, BADGE_GLOBAL_PILL, BADGE_PRIVATE_PILL } from '@/utils/badges'`
3. Replace template badge styles:
   - Line ~269: `style="background:#f0efed;...border-radius:8px..."` → `:style="BADGE_PRIVATE"`
   - Line ~292: `style="background:#e0e7ff;...border-radius:10px..."` (内置) → `:style="BADGE_CLAWHUB"`
   - Line ~294: `style="background:#f5f4f2;...border-radius:10px..."` (全局) → `:style="BADGE_GLOBAL_PILL"`
   - Line ~302: `style="background:#f0efed;...border-radius:10px..."` (专属) → `:style="BADGE_PRIVATE_PILL"`

- [ ] **Step 1: Remove local SOURCE_COLORS and sourceBadgeStyle (lines 16–32)**

Delete:
```typescript
const SOURCE_COLORS = [
  { bg: '#e0e7ff', color: '#4f46e5' },
  { bg: '#dcfce7', color: '#16a34a' },
  { bg: '#fef9c3', color: '#a16207' },
  { bg: '#fce7f3', color: '#be185d' },
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#fff7ed', color: '#c2410c' },
  { bg: '#f3e8ff', color: '#7c3aed' },
  { bg: '#ecfeff', color: '#0e7490' },
]
function sourceBadgeStyle(source: string | undefined) {
  if (!source) return 'background:#f0efed;color:#6b6b6b'
  let hash = 0
  for (const c of source) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  const { bg, color } = SOURCE_COLORS[hash % SOURCE_COLORS.length]
  return `background:${bg};color:${color}`
}
```

- [ ] **Step 2: Add import**

Change:
```typescript
import type { SkillItem } from '@/types'
```
To:
```typescript
import type { SkillItem } from '@/types'
import { sourceBadgeStyle, BADGE_PRIVATE, BADGE_CLAWHUB, BADGE_GLOBAL_PILL, BADGE_PRIVATE_PILL } from '@/utils/badges'
```

- [ ] **Step 3: Replace badge style at ~line 269 (专属技能, 8px)**

Find:
```html
style="background:#f0efed;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600"
```
(The one with text `专属技能`)
Replace with:
```html
:style="BADGE_PRIVATE"
```

- [ ] **Step 4: Replace badge style at ~line 292 (内置 MCP, 10px indigo)**

Find:
```html
style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">内置</span>
```
Replace with:
```html
:style="BADGE_CLAWHUB">内置</span>
```

- [ ] **Step 5: Replace badge style at ~line 294 (全局, 10px gray)**

Find:
```html
style="background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">全局</span>
```
Replace with:
```html
:style="BADGE_GLOBAL_PILL">全局</span>
```

- [ ] **Step 6: Replace badge style at ~line 302 (专属, 10px gray)**

Find:
```html
style="background:#f0efed;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">专属</span>
```
Replace with:
```html
:style="BADGE_PRIVATE_PILL">专属</span>
```

- [ ] **Step 7: Verify build**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/website/src/views/agents/AgentDetailView.vue
git commit -m "refactor(website): AgentDetailView - import badges from utils"
```

---

### Task 6: Update `AgentMcpModal.vue`

**Files:**
- Modify: `packages/website/src/views/agents/AgentMcpModal.vue:200-248` (remove schema functions)
- Modify: `packages/website/src/views/agents/AgentMcpModal.vue` template (replace badge styles)

**What to change:**
1. Remove the entire schema rendering block (lines 200–248): `esc`, `formatParamType`, `renderSchemaChildren`, `renderParamRow`, `renderToolParams`, `serverAddr`
2. Add import: `import { esc, formatParamType, renderSchemaChildren, renderParamRow, renderToolParams, serverAddr } from '@/utils/mcpSchema'`
3. Add badge import: `import { BADGE_BUILTIN, BADGE_GLOBAL } from '@/utils/badges'`
4. Replace in template:
   - Line ~315: `style="...border-radius:8px..."` (内置, isBuiltin) → `:style="BADGE_BUILTIN"`
   - Line ~316: `style="background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600"` → `:style="BADGE_GLOBAL"`

- [ ] **Step 1: Remove schema rendering block (lines 200–248)**

Delete from `AgentMcpModal.vue`:
```typescript
// ── Schema rendering ─────────────────────────────────────────────
function esc(s: string) { ... }
function formatParamType(s: any): string { ... }
function renderSchemaChildren(s: any): string { ... }
function renderParamRow(name: string, prop: any, isRequired: boolean): string { ... }
function renderToolParams(schema: any): string { ... }
function serverAddr(s: McpEntry) { ... }
```
(Remove the entire block from the `// ── Schema rendering` comment through `serverAddr`'s closing brace)

- [ ] **Step 2: Add imports to script setup**

Change:
```typescript
import type { McpEntry, McpTool } from '@/types'
```
To:
```typescript
import type { McpEntry, McpTool } from '@/types'
import { esc, formatParamType, renderSchemaChildren, renderParamRow, renderToolParams, serverAddr } from '@/utils/mcpSchema'
import { BADGE_BUILTIN, BADGE_GLOBAL } from '@/utils/badges'
```

- [ ] **Step 3: Replace built-in badge style in template (~line 315)**

Find:
```html
style="flex-shrink:0;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600"
```
Replace with:
```html
:style="`flex-shrink:0;${BADGE_BUILTIN}`"
```

- [ ] **Step 4: Replace global/custom badge style in template (~line 316)**

Find:
```html
style="flex-shrink:0;background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600"
```
Replace with:
```html
:style="`flex-shrink:0;${BADGE_GLOBAL}`"
```

- [ ] **Step 5: Verify build**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/website/src/views/agents/AgentMcpModal.vue
git commit -m "refactor(website): AgentMcpModal - import mcpSchema and badges from utils"
```

---

### Task 7: Update `McpView.vue`

**Files:**
- Modify: `packages/website/src/views/McpView.vue:254-362` (remove schema functions)
- Modify: `packages/website/src/views/McpView.vue` template (replace badge styles)

**What to change:**
1. Remove schema rendering block (lines 254–362): `esc`, `formatParamType`, `renderSchemaChildren`, `renderParamRow`, `renderToolParams`, `serverAddr`
2. Add import: `import { esc, formatParamType, renderSchemaChildren, renderParamRow, renderToolParams, serverAddr } from '@/utils/mcpSchema'`
3. Add badge import: `import { BADGE_BUILTIN, BADGE_GLOBAL } from '@/utils/badges'`
4. Replace in template:
   - Line ~427: `style="flex-shrink:0;background:#e0e7ff;..."` (内置) → `:style="\`flex-shrink:0;${BADGE_BUILTIN}\`"`
   - Line ~476: `style="background:#e0e7ff;..."` (内置, no flex-shrink) → `:style="BADGE_BUILTIN"`
   - Line ~428: `style="flex-shrink:0;background:#f5f4f2;..."` (custom desc) → `:style="\`flex-shrink:0;${BADGE_GLOBAL}\`"`

- [ ] **Step 1: Remove schema rendering block**

Delete from `McpView.vue`:
```typescript
// ── Schema rendering (ported from clientbackup) ──
function esc(s: string): string { ... }
function formatParamType(s: any): string { ... }
function renderSchemaChildren(s: any): string { ... }
function renderParamRow(name: string, prop: any, isRequired: boolean): string { ... }
function renderToolParams(schema: any): string { ... }
function serverAddr(s: McpEntry) { ... }
```
(Remove from the `// ── Schema rendering` comment through `serverAddr`'s closing brace, i.e., lines 254–362)

- [ ] **Step 2: Add imports**

Change:
```typescript
import type { McpEntry, McpBuiltin, McpTool } from '@/types'
```
To:
```typescript
import type { McpEntry, McpBuiltin, McpTool } from '@/types'
import { esc, formatParamType, renderSchemaChildren, renderParamRow, renderToolParams, serverAddr } from '@/utils/mcpSchema'
import { BADGE_BUILTIN, BADGE_GLOBAL } from '@/utils/badges'
```

- [ ] **Step 3: Replace badge styles in template**

Find (~line 427, 内置 with flex-shrink):
```html
style="flex-shrink:0;background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600"
```
Replace with:
```html
:style="`flex-shrink:0;${BADGE_BUILTIN}`"
```

Find (~line 476, 内置 without flex-shrink):
```html
style="background:#e0e7ff;color:#4f46e5;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;margin-right:6px"
```
Replace with:
```html
:style="`${BADGE_BUILTIN};margin-right:6px`"
```

Find (~line 428, custom desc with flex-shrink):
```html
style="flex-shrink:0;background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600"
```
Replace with:
```html
:style="`flex-shrink:0;${BADGE_GLOBAL}`"
```

- [ ] **Step 4: Verify build**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/views/McpView.vue
git commit -m "refactor(website): McpView - import mcpSchema and badges from utils"
```

---

## Chunk 3: Final verification

### Task 8: Full build and smoke test

- [ ] **Step 1: Run full TypeScript check**

Run: `cd e:/sbot/packages/website && npx tsc --noEmit`
Expected: Exit 0, no errors

- [ ] **Step 2: Run Vite build**

Run: `cd e:/sbot/packages/website && npx vite build`
Expected: Build succeeds, `dist/` is populated, no warnings about missing exports

- [ ] **Step 3: Confirm no remaining local SOURCE_COLORS**

Run: `grep -r "SOURCE_COLORS" packages/website/src --include="*.vue" --include="*.ts" -l`
Expected: Only `utils/badges.ts` listed (no view files)

- [ ] **Step 4: Confirm no remaining local sourceBadgeStyle**

Run: `grep -r "function sourceBadgeStyle" packages/website/src --include="*.vue" --include="*.ts"`
Expected: Only `utils/badges.ts`

- [ ] **Step 5: Confirm no remaining local schema functions**

Run: `grep -r "function renderToolParams\|function formatParamType\|function renderSchemaChildren\|function renderParamRow" packages/website/src --include="*.vue" --include="*.ts"`
Expected: Only `utils/mcpSchema.ts`

- [ ] **Step 6: Print commit log to confirm all work is committed**

Run: `git log --oneline -8`
Expected: See 7 commits from this refactor (2 util creates + 5 view updates)
