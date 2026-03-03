import { URL } from 'url';
import { httpGetJson, httpGetText, requireHttpUrl } from './types';
import { normalizeBundle, writeSkillToDisk, type Bundle } from './bundle';
import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const BASE_URL = 'https://skills.sh';

/**
 * skills.sh 实现
 *
 * 搜索 API：`https://skills.sh/api/search?q=...&limit=...`
 * 安装 URL 格式：`https://skills.sh/{owner}/{repo}/{skill}`
 */
export class SkillsShSkillHubService implements ISkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const data = await httpGetJson<any>(`${BASE_URL}/api/search`, { q: query, limit: String(limit) });
    const items: any[] = Array.isArray(data?.skills) ? data.skills : [];
    return items
      .filter(item => item?.id && item?.name)
      .map(item => ({
        slug: String(item.id),
        name: String(item.name),
        description: item.source ? `来自 ${item.source}` : '',
        version: item.installs != null ? `${item.installs} installs` : '',
        sourceUrl: `${BASE_URL}/${item.id}`,
        provider: 'skillssh' as const,
      }));
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
    const sourceUrl = `${BASE_URL}/${owner}/${repo}/${skill}`;
    const params: Record<string, string> = {};
    if (version) params.version = version;

    const content = await httpGetText(`${BASE_URL}/${owner}/${repo}/${skill}/SKILL.md`, params);
    return { bundle: normalizeBundle({ name: skill, files: { 'SKILL.md': content } }), sourceUrl };
  }
}
