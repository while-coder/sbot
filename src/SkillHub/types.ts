export interface HubSkillResult {
  slug: string;
  name: string;
  description: string;
  version: string;
  sourceUrl: string;
}

export interface HubInstallResult {
  /** Skill 名称（来自 SKILL.md frontmatter） */
  name: string;
  /** 写入磁盘后的 skill 目录绝对路径 */
  path: string;
  /** 实际来源 URL */
  sourceUrl: string;
}

export interface InstallSkillOptions {
  /** 版本号（默认取最新版） */
  version?: string;
  /** 是否覆盖已存在的同名 skill 目录（默认 false） */
  overwrite?: boolean;
}

export interface ISkillHubService {
  /**
   * 搜索可用的 Skills
   * @param query  搜索关键词
   * @param limit  最多返回条数（默认 20）
   */
  searchSkills(query: string, limit?: number): Promise<HubSkillResult[]>;

  /**
   * 从 URL 安装 Skill 到本地目录
   * @param bundleUrl  Skill 来源 URL
   * @param targetDir  安装目标父目录
   * @param options    可选配置（version / overwrite）
   */
  installSkill(bundleUrl: string, targetDir: string, options?: InstallSkillOptions): Promise<HubInstallResult>;
}
