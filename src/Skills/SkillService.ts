import { Skill } from "./types";
import { loadSkills, readSkillContent, getSkillFilePath } from "./loader";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("SkillService.ts");

/**
 * Skill 服务配置
 */
export interface SkillServiceConfig {
  skillsDir?: string;
}

/**
 * Skill 服务
 * 管理技能的加载、查询和访问
 */
export class SkillService {
  private skills: Skill[] | undefined;
  private skillsMap: Map<string, Skill> = new Map();

  constructor(skillsDir?: string) {
    if (skillsDir) {
      this.loadSkills(skillsDir);
      logger.info(`技能服务已初始化，加载了 ${this.skills?.length ?? 0} 个技能`);
    } else {
      logger.info("技能服务已初始化（未配置技能目录）");
    }
  }

  /**
   * 加载所有技能
   */
  private loadSkills(skillsDir: string): void {
    if (this.skills) return;

    try {
      this.skills = loadSkills(skillsDir);

      // 构建名称到技能的映射
      this.skillsMap.clear();
      for (const skill of this.skills) {
        this.skillsMap.set(skill.name, skill);
      }

      logger.info(`成功加载 ${this.skills.length} 个技能: ${this.skills.map(s => s.name).join(", ")}`);
    } catch (error: any) {
      logger.error(`加载技能失败: ${error.message}`);
      this.skills = [];
    }
  }

  /**
   * 获取所有已加载的技能
   */
  getAllSkills(): Skill[] {
    return this.skills ?? [];
  }

  /**
   * 根据名称获取技能
   */
  getSkillByName(name: string): Skill | undefined {
    return this.skillsMap.get(name);
  }

  /**
   * 检查技能是否存在
   */
  hasSkill(name: string): boolean {
    return this.skillsMap.has(name);
  }

  /**
   * 读取技能的 SKILL.md 内容
   */
  readSkillContent(skillName: string): string | null {
    const skill = this.getSkillByName(skillName);
    if (!skill) {
      logger.warn(`技能不存在: ${skillName}`);
      return null;
    }

    return readSkillContent(skill);
  }

  /**
   * 获取技能文件的完整路径
   */
  getSkillFilePath(skillName: string, relativePath: string): string | null {
    const skill = this.getSkillByName(skillName);
    if (!skill) {
      logger.warn(`技能不存在: ${skillName}`);
      return null;
    }

    return getSkillFilePath(skill, relativePath);
  }

  /**
   * 搜索技能（根据名称或描述）
   */
  searchSkills(query: string): Skill[] {
    if (!this.skills) return [];

    const lowerQuery = query.toLowerCase();
    return this.skills.filter(skill =>
      skill.name.toLowerCase().includes(lowerQuery) ||
      skill.description.toLowerCase().includes(lowerQuery)
    );
  }
}
