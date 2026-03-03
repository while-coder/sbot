import { URL } from 'url';
import { httpGetJson, httpGetText, requireHttpUrl } from './types';
import { normalizeBundle, writeSkillToDisk, mapToHubResults, type Bundle } from './bundle';
import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

/**
 * skills.sh 实现
 *
 * 安装 URL 格式：`https://skills.sh/{owner}/{repo}/{skill}`
 */
export class SkillsShSkillHubService implements ISkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const data = await httpGetJson<any>('https://skills.sh/api/v1/search', { q: query, limit: String(limit) });

    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object') {
      for (const key of ['items', 'skills', 'results', 'data']) {
        if (Array.isArray(data[key])) { items = data[key]; break; }
      }
    }

    return mapToHubResults(items);
  }

  async installSkill(bundleUrl: string, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
    requireHttpUrl(bundleUrl);

    const u = new URL(bundleUrl);
    if (u.hostname !== 'skills.sh' && u.hostname !== 'www.skills.sh') {
      throw new Error(`SkillsShSkillHubService 仅支持 skills.sh URL，收到: ${bundleUrl}`);
    }

    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 3) throw new Error(`skills.sh URL 格式应为 /owner/repo/skill，收到: ${u.pathname}`);
    const [owner, repo, skill] = parts;

    const { version = '', overwrite = false } = options;
    const { bundle, sourceUrl } = await this._fetch(owner, repo, skill, version);
    const skillPath = writeSkillToDisk(bundle, targetDir, overwrite);
    return { name: bundle.name, path: skillPath, sourceUrl };
  }

  private async _fetch(
    owner: string, repo: string, skill: string, version: string,
  ): Promise<{ bundle: Bundle; sourceUrl: string }> {
    const sourceUrl = `https://skills.sh/${owner}/${repo}/${skill}`;
    const params: Record<string, string> = {};
    if (version) params.version = version;

    // Try JSON API first
    try {
      const data = await httpGetJson<any>(`https://skills.sh/api/v1/skills/${owner}/${repo}/${skill}`, params);
      return { bundle: normalizeBundle(data), sourceUrl };
    } catch { /* fall through */ }

    // Fallback: direct SKILL.md
    const content = await httpGetText(`https://skills.sh/${owner}/${repo}/${skill}/SKILL.md`, params);
    return { bundle: normalizeBundle({ name: skill, files: { 'SKILL.md': content } }), sourceUrl };
  }
}
