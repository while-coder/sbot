// packages/admin/src/utils/badges.ts
import { isDark } from '@/composables/useTheme'

/** Color pool used for source-keyed badge coloring (hash-assigned). */
const SOURCE_COLORS_LIGHT = [
  { bg: '#e0e7ff', color: '#4f46e5' },
  { bg: '#dcfce7', color: '#16a34a' },
  { bg: '#fef9c3', color: '#a16207' },
  { bg: '#fce7f3', color: '#be185d' },
  { bg: '#e0f2fe', color: '#0369a1' },
  { bg: '#fff7ed', color: '#c2410c' },
  { bg: '#f3e8ff', color: '#7c3aed' },
  { bg: '#ecfeff', color: '#0e7490' },
]

const SOURCE_COLORS_DARK = [
  { bg: '#312e81', color: '#a5b4fc' },
  { bg: '#14532d', color: '#86efac' },
  { bg: '#422006', color: '#fcd34d' },
  { bg: '#500724', color: '#f9a8d4' },
  { bg: '#1e3a5f', color: '#93c5fd' },
  { bg: '#431407', color: '#fdba74' },
  { bg: '#3b2d5c', color: '#c4b5fd' },
  { bg: '#134e4a', color: '#5eead4' },
]

/**
 * @deprecated kept for back-compat — prefer the reactive variant {@link sourceBadgeStyle}.
 * Hard-coded light palette.
 */
export const SOURCE_COLORS = SOURCE_COLORS_LIGHT

/** Returns an inline style string for a source badge, using a hash of the source string. */
export function sourceBadgeStyle(source: string | undefined): string {
  const dark = isDark.value
  if (!source) return dark ? 'background:#333;color:#aaa' : 'background:#f0efed;color:#6b6b6b'
  let hash = 0
  for (const c of source) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  const pool = dark ? SOURCE_COLORS_DARK : SOURCE_COLORS_LIGHT
  const { bg, color } = pool[hash % pool.length]
  return `background:${bg};color:${color}`
}

// ── Fixed badge style helpers ─────────────────────────────────────
// Functions are theme-aware (read isDark reactively when invoked in templates).

const PILL_8  = 'font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600'
const PILL_10 = 'font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600'

export function badgeBuiltin(): string {
  return isDark.value
    ? `background:#312e81;color:#a5b4fc;${PILL_8}`
    : `background:#e0e7ff;color:#4f46e5;${PILL_8}`
}
export function badgeGlobal(): string {
  return isDark.value
    ? `background:#2a2a2a;color:#aaa;${PILL_8}`
    : `background:#f5f4f2;color:#6b6b6b;${PILL_8}`
}
export function badgePrivate(): string {
  return isDark.value
    ? `background:#333;color:#aaa;${PILL_8}`
    : `background:#f0efed;color:#6b6b6b;${PILL_8}`
}
export function badgeClawhub(): string {
  return isDark.value
    ? `background:#312e81;color:#a5b4fc;${PILL_10}`
    : `background:#e0e7ff;color:#4f46e5;${PILL_10}`
}
export function badgeSkillssh(): string {
  return isDark.value
    ? `background:#134e4a;color:#5eead4;${PILL_10}`
    : `background:#ecfeff;color:#0e7490;${PILL_10}`
}
export function badgeGlobalPill(): string {
  return isDark.value
    ? `background:#2a2a2a;color:#aaa;${PILL_10}`
    : `background:#f5f4f2;color:#6b6b6b;${PILL_10}`
}
export function badgePrivatePill(): string {
  return isDark.value
    ? `background:#333;color:#aaa;${PILL_10}`
    : `background:#f0efed;color:#6b6b6b;${PILL_10}`
}
export function badgeInstalled(): string {
  return isDark.value
    ? 'background:#14532d;color:#86efac;font-size:10px;padding:2px 8px;border-radius:6px;font-weight:600'
    : 'background:#dcfce7;color:#16a34a;font-size:10px;padding:2px 8px;border-radius:6px;font-weight:600'
}

// ── Legacy constants (light-only) kept for back-compat with any old imports.
// New code should call the theme-aware functions above.
export const BADGE_BUILTIN       = `background:#e0e7ff;color:#4f46e5;${PILL_8}`
export const BADGE_GLOBAL        = `background:#f5f4f2;color:#6b6b6b;${PILL_8}`
export const BADGE_PRIVATE       = `background:#f0efed;color:#6b6b6b;${PILL_8}`
export const BADGE_CLAWHUB       = `background:#e0e7ff;color:#4f46e5;${PILL_10}`
export const BADGE_SKILLSSH      = `background:#ecfeff;color:#0e7490;${PILL_10}`
export const BADGE_GLOBAL_PILL   = `background:#f5f4f2;color:#6b6b6b;${PILL_10}`
export const BADGE_PRIVATE_PILL  = `background:#f0efed;color:#6b6b6b;${PILL_10}`
export const BADGE_INSTALLED     = 'background:#dcfce7;color:#16a34a;font-size:10px;padding:2px 8px;border-radius:6px;font-weight:600'
