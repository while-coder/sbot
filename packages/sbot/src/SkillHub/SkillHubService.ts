import { URL } from 'url';
import { ClawhubSkillHubService } from './ClawhubSkillHubService';
import { SkillsShSkillHubService } from './SkillsShSkillHubService';
import { SkillsmpSkillHubService } from './SkillsmpSkillHubService';
import { SkillHubProvider } from './types';
import type { HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const _clawhub = new ClawhubSkillHubService();
const _skillsSh = new SkillsShSkillHubService();
const _skillsmp = new SkillsmpSkillHubService();

/**
 * SkillHubService — 聚合 clawhub.ai、skills.sh 和 skillsmp.com
 */
export class SkillHubService {
  /** 并发搜索所有 provider，合并返回结果 */
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const results = await Promise.allSettled([
      _clawhub.searchSkills(query, limit),
      _skillsSh.searchSkills(query, limit),
      _skillsmp.searchSkills(query, limit),
    ]);
    return results
      .filter((r): r is PromiseFulfilledResult<HubSkillResult[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  async installSkill(
    skill: HubSkillResult,
    targetDir: string,
    options?: InstallSkillOptions,
  ): Promise<HubInstallResult> {
    const impl = skill.provider === SkillHubProvider.Clawhub ? _clawhub
      : skill.provider === SkillHubProvider.SkillsMp ? _skillsmp
      : _skillsSh;
    return impl.installSkill(skill, targetDir, options);
  }

  async installSkillWithUrl(url: string, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    const host = new URL(url).hostname;
    const impl = host.includes('clawhub.ai') ? _clawhub
      : host.includes('skillsmp.com') ? _skillsmp
      : _skillsSh;
    return impl.installSkillWithUrl(url, targetDir, options);
  }
}
