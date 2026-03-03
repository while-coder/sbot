import { ClawhubSkillHubService } from './ClawhubSkillHubService';
import { SkillsShSkillHubService } from './SkillsShSkillHubService';
import type { HubSkillResult, HubInstallResult, InstallSkillOptions, SkillHubProvider } from './types';

const _clawhub = new ClawhubSkillHubService();
const _skillsSh = new SkillsShSkillHubService();

/**
 * SkillHubService — 聚合 clawhub.ai 和 skills.sh
 */
export class SkillHubService {
  /** 并发搜索 ClawHub 和 skills.sh，合并返回结果 */
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const results = await Promise.allSettled([
      _clawhub.searchSkills(query, limit),
      _skillsSh.searchSkills(query, limit),
    ]);
    return results
      .filter((r): r is PromiseFulfilledResult<HubSkillResult[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  async installSkill(
    provider: SkillHubProvider,
    bundleUrl: string,
    targetDir: string,
    options?: InstallSkillOptions,
  ): Promise<HubInstallResult> {
    const impl = provider === 'clawhub' ? _clawhub : _skillsSh;
    return impl.installSkill(bundleUrl, targetDir, options);
  }
}
