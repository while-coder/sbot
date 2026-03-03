import { URL } from 'url';
import { requireHttpUrl } from './bundle';
import { ClawhubSkillHubService } from './ClawhubSkillHubService';
import { SkillsShSkillHubService } from './SkillsShSkillHubService';
import type { ISkillHubService, HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const _clawhub = new ClawhubSkillHubService();
const _skillsSh = new SkillsShSkillHubService();

/**
 * SkillHubService — 根据 URL 自动路由到对应实现
 *
 * 支持：
 * - `https://clawhub.ai/{slug}`
 * - `https://skills.sh/{owner}/{repo}/{skill}`
 */
export class SkillHubService implements ISkillHubService {
  /** 搜索 ClawHub 上的 Skills（默认搜索来源） */
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    return _clawhub.searchSkills(query, limit);
  }

  async installSkill(bundleUrl: string, targetDir: string, options: InstallSkillOptions = {}): Promise<HubInstallResult> {
    requireHttpUrl(bundleUrl);
    return this._resolve(bundleUrl).installSkill(bundleUrl, targetDir, options);
  }

  private _resolve(bundleUrl: string): ISkillHubService {
    const host = new URL(bundleUrl).hostname;
    if (host.includes('clawhub.ai')) return _clawhub;
    if (['skills.sh', 'www.skills.sh'].includes(host)) return _skillsSh;
    throw new Error(`不支持的 URL。仅支持 clawhub.ai 和 skills.sh，收到: ${bundleUrl}`);
  }
}
