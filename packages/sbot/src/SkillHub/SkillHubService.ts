import { ClawhubSkillHubService } from './ClawhubSkillHubService';
import { SkillsShSkillHubService } from './SkillsShSkillHubService';
import { SkillHubProvider } from './types';
import type { HubSkillResult, HubInstallResult, InstallSkillOptions, ISkillHubService } from './types';

const _clawhub = new ClawhubSkillHubService();
const _skillsSh = new SkillsShSkillHubService();

const providers: Record<string, ISkillHubService> = {
  [SkillHubProvider.Clawhub]: _clawhub,
  [SkillHubProvider.SkillsSh]: _skillsSh,
};

/**
 * SkillHubService — 聚合多个 provider（clawhub.ai + skills.sh）
 */
export class SkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const results = await Promise.allSettled([
      _clawhub.searchSkills(query, limit),
      _skillsSh.searchSkills(query, limit),
    ]);
    return results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  }

  async installSkill(
    skill: HubSkillResult,
    targetDir: string,
    options?: InstallSkillOptions,
  ): Promise<HubInstallResult> {
    const svc = providers[skill.provider] ?? _clawhub;
    return svc.installSkill(skill, targetDir, options);
  }

  async installSkillWithUrl(url: string, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    const svc = url.includes('skills.sh') ? _skillsSh : _clawhub;
    return svc.installSkillWithUrl(url, targetDir, options);
  }
}
