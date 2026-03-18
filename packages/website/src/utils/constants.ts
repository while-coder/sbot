export const GITHUB_REPO = 'while-coder/sbot'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`
export const GITHUB_ISSUES_URL = `https://github.com/${GITHUB_REPO}/issues/new`
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
export const GITHUB_README_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/README.md`

const NPM_LATEST_API = `https://registry.npmjs.org/@qingfeng346/sbot/latest`
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
  }
  return 0
}

export async function fetchLatestRelease(): Promise<{ tag_name: string; html_url: string; body: string } | null> {
  try {
    const res = await fetch(NPM_LATEST_API)
    if (!res.ok) return null
    const data = await res.json()
    const version: string = data.version || ''
    if (!version) return null
    const tag = version.startsWith('v') ? version : `v${version}`
    return { tag_name: tag, html_url: `${GITHUB_RELEASES_URL}/tag/${tag}`, body: '' }
  } catch {
    return null
  }
}
