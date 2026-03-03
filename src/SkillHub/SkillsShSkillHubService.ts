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
    if (parts.length < 3) throw new Error(`skills.sh URL 格式应为 /owner/repo/skill，收到: ${u.pathname}`);
    const id = parts.slice(0, 3).join('/');

    const { version = '', overwrite = false } = options;
    const { bundle, sourceUrl } = await this._fetch(id, version);
    bundle.id = id;
    const skillPath = writeSkillToDisk(bundle, targetDir, overwrite);
    return { id, name: bundle.name, path: skillPath, sourceUrl };
  }

  private async _fetch(id: string, version: string): Promise<{ bundle: Bundle; sourceUrl: string }> {
    const sourceUrl = `${BASE_URL}/${id}`;
    const params: Record<string, string> = {};
    if (version) params.version = version;

    const content = await httpGetText(`${BASE_URL}/${id}/SKILL.md`, params);
    const name = id.split('/').pop() ?? id;
    return { bundle: normalizeBundle({ name, files: { 'SKILL.md': content } }), sourceUrl };
  }
}
