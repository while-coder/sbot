import { URL } from 'url';
import { httpGetJson, httpGetText, requireHttpUrl } from './types';
import { normalizeBundle, writeSkillToDisk, mapToHubResults, type Bundle } from './bundle';
import { SkillHubProvider } from './types';
import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const BASE_URL = 'https://clawhub.ai';

/**
 * clawhub.ai 实现
 *
 * 安装 URL 格式：`https://clawhub.ai/{slug}`
 */
export class ClawhubSkillHubService implements ISkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const data = await httpGetJson<any>(`${BASE_URL}/api/v1/search`, { q: query, limit: String(limit) });

    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object') {
      for (const key of ['items', 'skills', 'results', 'data']) {
        if (Array.isArray(data[key])) { items = data[key]; break; }
      }
    }

    return mapToHubResults(items, SkillHubProvider.Clawhub).map(r => ({
      ...r,
      sourceUrl: `${BASE_URL}/${r.id}`,
    }));
  }

  /** 从 HubSkillResult 安装（委托给 installSkillWithUrl） */
  async installSkill(skill: HubSkillResult, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    return this.installSkillWithUrl(skill.sourceUrl, targetDir, options);
  }

  /** 主要安装入口：直接从 URL 安装 */
  async installSkillWithUrl(url: string, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
    requireHttpUrl(url);

    const u = new URL(url);
    if (!u.hostname.includes('clawhub.ai')) {
      throw new Error(`ClawhubSkillHubService only supports clawhub.ai URLs, received: ${url}`);
    }

    const parts = u.pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] ?? '';
    if (!slug) throw new Error(`Unable to extract slug from URL: ${url}`);

    const { version = '', overwrite = false } = options;
    const { bundle, sourceUrl } = await this._fetch(slug, version);
    bundle.id = slug;
    const skillPath = writeSkillToDisk(bundle, targetDir, overwrite);
    return { id: slug, name: bundle.name, path: skillPath, sourceUrl };
  }

  private async _fetch(slug: string, version: string): Promise<{ bundle: Bundle; sourceUrl: string }> {
    const sourceUrl = `${BASE_URL}/api/v1/skills/${slug}`;
    const data = await httpGetJson<any>(sourceUrl);

    const versionHint = version || data?.latestVersion?.version || data?.skill?.tags?.latest || '';
    let versionObj = data?.version;

    if (versionHint && !versionObj?.files) {
      try {
        const versionData = await httpGetJson<any>(`${BASE_URL}/api/v1/skills/${slug}/versions/${versionHint}`);
        versionObj = versionData?.version ?? versionObj;
      } catch { /* fall through */ }
    }

    if (versionObj?.files && Array.isArray(versionObj.files)) {
      const fileUrl = `${BASE_URL}/api/v1/skills/${slug}/file`;
      const versionStr: string = versionObj.version ?? versionHint;
      const rawFiles: Record<string, string> = {};

      for (const item of versionObj.files) {
        const filePath: string = item?.path;
        if (!filePath) continue;
        const params: Record<string, string> = { path: filePath };
        if (versionStr) params.version = versionStr;
        try { rawFiles[filePath] = await httpGetText(fileUrl, params); } catch { /* skip */ }
      }

      const skillName = data?.skill?.displayName ?? data?.skill?.slug ?? slug;
      return { bundle: normalizeBundle({ name: skillName, files: rawFiles }), sourceUrl };
    }

    return { bundle: normalizeBundle(data), sourceUrl };
  }
}
