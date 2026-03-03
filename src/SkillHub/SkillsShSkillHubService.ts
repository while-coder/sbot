import { httpGetJson, httpGetText } from './types';
import { normalizeBundle, writeSkillToDisk, type Bundle } from './bundle';
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
        version: item.installs != null ? `${item.installs} installs` : '',
        sourceUrl: `${BASE_URL}/${item.id}`,
        provider: 'skillssh' as const,
      }));
  }

  async installSkill(skill: HubSkillResult, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
    const { version = '', overwrite = false } = options;
    const { bundle, sourceUrl } = await this._fetch(skill.id, version);
    bundle.id = skill.id;
    const skillPath = writeSkillToDisk(bundle, targetDir, overwrite);
    return { id: skill.id, name: bundle.name, path: skillPath, sourceUrl };
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
