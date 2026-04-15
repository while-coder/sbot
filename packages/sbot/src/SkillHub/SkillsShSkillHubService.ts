import { URL } from 'url';
import { httpGetJson, httpGetText } from './types';
import { normalizeBundle, writeSkillToDisk, type Bundle } from './bundle';
import { SkillHubProvider } from './types';
import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const BASE_URL = 'https://skills.sh';

/**
 * skills.sh 实现
 *
 * 搜索 API：`https://skills.sh/api/search?q=...&limit=...`
 * skill.id 格式：`{owner}/{repo}/{skill}`
 */
export class SkillsShSkillHubService implements ISkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const data = await httpGetJson<any>(`${BASE_URL}/api/search`, { q: query, limit: String(limit) });
    const items: any[] = Array.isArray(data?.skills) ? data.skills : [];
    return items
      .filter(item => item?.id && item?.name)
      .map(item => ({
        id: String(item.id),
        name: String(item.name),
        description: item.source ? `来自 ${item.source}` : '',
        version: '',
        sourceUrl: `${BASE_URL}/${item.id}`,
        provider: SkillHubProvider.SkillsSh,
      }));
  }

  /** 从 HubSkillResult 安装（委托给 installSkillWithUrl） */
  async installSkill(skill: HubSkillResult, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    return this.installSkillWithUrl(skill.sourceUrl, targetDir, options);
  }

  /** 主要安装入口：直接从 URL 安装 */
  async installSkillWithUrl(url: string, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error(`URL 格式应至少包含 owner/repo，收到: ${u.pathname}`);
    // skills.sh: /owner/repo/skill  |  github.com: /owner/repo (skill via --skill flag or tree path)
    const id = parts.slice(0, Math.min(parts.length, 3)).join('/');

    const { version = '', overwrite = false } = options;
    const { bundle, sourceUrl } = await this._fetch(id, version);
    bundle.id = id;
    const skillPath = writeSkillToDisk(bundle, targetDir, overwrite);
    return { id, name: bundle.name, path: skillPath, sourceUrl };
  }

  /**
   * id 格式: `owner/repo/skill`
   *
   * 1) 直接按目录名尝试 GitHub raw (main/master × skills/ 前缀)
   * 2) 若未命中，用 GitHub Tree API 扫描仓库所有 SKILL.md，
   *    按 frontmatter name 字段匹配（skills.sh 索引名可能与目录名不同）
   */
  private async _fetch(id: string, _version: string): Promise<{ bundle: Bundle; sourceUrl: string }> {
    const sourceUrl = `${BASE_URL}/${id}`;
    const parts = id.split('/');
    if (parts.length < 3) throw new Error(`skills.sh id 格式应为 owner/repo/skill，收到: ${id}`);
    const owner = parts[0];
    const repo = parts[1];
    const skill = parts.slice(2).join('/');
    const ghRaw = `https://raw.githubusercontent.com/${owner}/${repo}`;

    // ── 1) 直接按目录名尝试 ──
    let content: string | undefined;
    let branch = 'main';
    for (const b of ['main', 'master']) {
      for (const prefix of ['skills/', '']) {
        try {
          content = await httpGetText(`${ghRaw}/${b}/${prefix}${skill}/SKILL.md`);
          branch = b;
        } catch { /* try next */ }
        if (content) break;
      }
      if (content) break;
    }

    // ── 2) fallback: Tree API 扫描仓库，按 name 匹配 ──
    if (!content) {
      try {
        content = await this._fetchByTreeScan(owner, repo, skill);
      } catch { /* ignore */ }
    }

    if (!content) {
      const err: any = new Error(`Skill "${skill}" 在仓库 ${owner}/${repo} 中未找到`);
      err.status = 404;
      throw err;
    }

    const name = skill.split('/').pop() ?? skill;
    return { bundle: normalizeBundle({ name, files: { 'SKILL.md': content } }), sourceUrl };
  }

  /**
   * 用 GitHub Tree API 列出仓库中所有 SKILL.md，
   * 然后逐个拉取并匹配 frontmatter `name` 字段。
   */
  private async _fetchByTreeScan(owner: string, repo: string, skillName: string): Promise<string | undefined> {
    const ghApi = `https://api.github.com/repos/${owner}/${repo}`;

    // 获取默认分支
    let defaultBranch = 'main';
    try {
      const repoInfo = await httpGetJson<any>(ghApi);
      if (repoInfo?.default_branch) defaultBranch = repoInfo.default_branch;
    } catch { /* use main */ }

    // 列出所有文件
    const tree = await httpGetJson<any>(`${ghApi}/git/trees/${defaultBranch}?recursive=1`);
    const skillMdPaths: string[] = (tree?.tree ?? [])
      .filter((n: any) => n.type === 'blob' && n.path?.endsWith('/SKILL.md'))
      .map((n: any) => n.path as string);

    if (!skillMdPaths.length) return undefined;

    const ghRaw = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}`;

    for (const p of skillMdPaths) {
      try {
        const raw = await httpGetText(`${ghRaw}/${p}`);
        // 解析 frontmatter name
        const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
        if (m) {
          const nameMatch = m[1].match(/^name\s*:\s*['"]?(.+?)['"]?\s*$/m);
          if (nameMatch && nameMatch[1].trim() === skillName) {
            return raw;
          }
        }
      } catch { /* skip */ }
    }
    return undefined;
  }
}
