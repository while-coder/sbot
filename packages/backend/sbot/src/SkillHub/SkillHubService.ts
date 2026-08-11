import { ClawhubSkillHubService } from './ClawhubSkillHubService';
import { SkillsShSkillHubService } from './SkillsShSkillHubService';
import { SkillhubCnSkillHubService } from './SkillhubCnSkillHubService';
import type { HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const _clawhub = new ClawhubSkillHubService();
const _skillsSh = new SkillsShSkillHubService();
const _skillhubCn = new SkillhubCnSkillHubService();

/**
 * SkillHubService — 聚合多个 provider（clawhub.ai + skills.sh + skillhub.cn）
 */
export class SkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    const results = await Promise.allSettled([
      _clawhub.searchSkills(query, limit),
      _skillsSh.searchSkills(query, limit),
      _skillhubCn.searchSkills(query, limit),
    ]);
    return results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  }

  async installSkill(url: string, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    if (url.includes('skillhub.cn')) return _skillhubCn.installSkill(url, targetDir, options);
    if (url.includes('skills.sh')) return _skillsSh.installSkill(url, targetDir, options);
    return _clawhub.installSkill(url, targetDir, options);
  }
}
