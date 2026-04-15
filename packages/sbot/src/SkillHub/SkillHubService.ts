import { ClawhubSkillHubService } from './ClawhubSkillHubService';
import { SkillsShSkillHubService } from './SkillsShSkillHubService';
import type { HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const _clawhub = new ClawhubSkillHubService();
const _skillsSh = new SkillsShSkillHubService();

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

  async installSkill(url: string, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    const svc = url.includes('skills.sh') ? _skillsSh : _clawhub;
    return svc.installSkill(url, targetDir, options);
  }
}
