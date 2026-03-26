export const NPM_PACKAGE = '@qingfeng346/sbot'
export const NPM_URL = `https://www.npmjs.com/package/${NPM_PACKAGE}`
export const DOCKER_IMAGE = 'qingfeng346/sbot'
export const DOCKER_URL = `https://hub.docker.com/r/${DOCKER_IMAGE}`
export const NPM_LATEST_API = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`
export const GITHUB_REPO = 'while-coder/sbot'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`
export const GITHUB_ISSUES_URL = `https://github.com/${GITHUB_REPO}/issues/new`
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
export const GITHUB_README_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/README.md`
export const GITHUB_README_ZH_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/README.zh.md`

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
  }
  return 0
}

export async function fetchLatestRelease(): Promise<{ tag: string; url: string; releasenoteEn: string; releasenoteZh: string } | null> {
  try {
    const res = await fetch(NPM_LATEST_API)
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>
    const version: string = (data.version as string) || ''
    if (!version) return null
    const tag = version.startsWith('v') ? version : `v${version}`
    return { tag, url: `${GITHUB_RELEASES_URL}/tag/${tag}`, releasenoteEn: (data.releasenoteEn as string) || '', releasenoteZh: (data.releasenoteZh as string) || '' }
  } catch {
    return null
  }
}
