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
export const BADGE_SKILLSSH      = 'background:#ecfeff;color:#0e7490;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600'
export const BADGE_GLOBAL_PILL   = 'background:#f5f4f2;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600'
export const BADGE_PRIVATE_PILL  = 'background:#f0efed;color:#6b6b6b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600'

// Other status badges
export const BADGE_INSTALLED = 'background:#dcfce7;color:#16a34a;font-size:10px;padding:2px 8px;border-radius:6px;font-weight:600'
