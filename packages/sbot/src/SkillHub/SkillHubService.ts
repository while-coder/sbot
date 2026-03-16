import { ClawhubSkillHubService } from './ClawhubSkillHubService';
import type { HubSkillResult, HubInstallResult, InstallSkillOptions } from './types';

const _clawhub = new ClawhubSkillHubService();

/**
 * SkillHubService — clawhub.ai
 */
export class SkillHubService {
  async searchSkills(query: string, limit = 20): Promise<HubSkillResult[]> {
    return _clawhub.searchSkills(query, limit);
  }

  async installSkill(
    skill: HubSkillResult,
    targetDir: string,
    options?: InstallSkillOptions,
  ): Promise<HubInstallResult> {
    return _clawhub.installSkill(skill, targetDir, options);
  }

  async installSkillWithUrl(url: string, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult> {
    return _clawhub.installSkillWithUrl(url, targetDir, options);
  }
}
