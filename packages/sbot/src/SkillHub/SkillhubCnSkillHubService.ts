import { URL } from 'url';
import { httpGetJson, httpGetText, requireHttpUrl } from './types';
import { normalizeBundle, writeSkillToDisk, type Bundle } from './bundle';
import { SkillHubProvider } from './types';
import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const BASE_SITE = 'https://www.skillhub.cn';
const BASE_API = 'https://api.skillhub.cn';

/**
 * skillhub.cn 实现（腾讯云 SkillHub）
 *
 * 安装 URL 格式：`https://www.skillhub.cn/skills/{slug}`
 *                 或 `https://api.skillhub.cn/{owner}/{slug}`（detail.homepage 格式）
 */
export class SkillhubCnSkillHubService implements ISkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const params: Record<string, string> = {
      page: '1',
      pageSize: String(limit),
    };
    if (query?.trim()) params.keyword = query.trim();

    const data = await httpGetJson<any>(`${BASE_API}/api/skills`, params);
    const items: any[] = Array.isArray(data?.data?.skills) ? data.data.skills : [];

    return items
      .filter(item => item?.slug)
      .map(item => {
        const slug = String(item.slug);
        const desc = String(item.description_zh ?? item.description ?? '');
        return {
          id: slug,
          name: String(item.name ?? slug),
          description: desc,
          version: String(item.version ?? ''),
          sourceUrl: `${BASE_SITE}/skills/${slug}`,
          provider: SkillHubProvider.SkillhubCn,
          ...(item.score != null ? { score: Number(item.score) } : {}),
          ...(item.updated_at != null ? { updatedAt: Number(item.updated_at) } : {}),
          ...(item.installs != null ? { installs: Number(item.installs) } : {}),
        };
      });
  }

  async installSkill(url: string, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
    requireHttpUrl(url);

    const u = new URL(url);
    if (!u.hostname.includes('skillhub.cn')) {
      throw new Error(`SkillhubCnSkillHubService only supports skillhub.cn URLs, received: ${url}`);
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
    const sourceUrl = `${BASE_SITE}/skills/${slug}`;
    const detail = await httpGetJson<any>(`${BASE_API}/api/v1/skills/${encodeURIComponent(slug)}`);

    const versionStr: string =
      version
      || detail?.latestVersion?.version
      || detail?.skill?.tags?.latest
      || '';

    const filesParams = versionStr ? { version: versionStr } : undefined;
    const filesResp = await httpGetJson<any>(
      `${BASE_API}/api/v1/skills/${encodeURIComponent(slug)}/files`,
      filesParams,
    );
    const fileEntries: any[] = Array.isArray(filesResp?.files) ? filesResp.files : [];
    if (!fileEntries.length) throw new Error(`skillhub.cn: no files for skill '${slug}'`);

    const fileUrl = `${BASE_API}/api/v1/skills/${encodeURIComponent(slug)}/file`;
    const rawFiles: Record<string, string> = {};

    for (const item of fileEntries) {
      const filePath: string = item?.path;
      if (!filePath) continue;
      const params: Record<string, string> = { path: filePath };
      if (versionStr) params.version = versionStr;
      try { rawFiles[filePath] = await httpGetText(fileUrl, params); } catch { /* skip */ }
    }

    const skillName = detail?.skill?.displayName ?? detail?.skill?.slug ?? slug;
    return { bundle: normalizeBundle({ name: skillName, files: rawFiles }), sourceUrl };
  }
}
