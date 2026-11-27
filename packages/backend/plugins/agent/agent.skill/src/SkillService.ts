import {
    Skill,
    T_SkillSystemPromptTemplate,
} from "./shared";
import { parseSkill, isValidSkillDirectory } from "./loader";
import fs from "fs";
import path from "path";
import {
    type AgentPluginContext,
    IAgentPlugin,
    ILoggerService,
    formatError,
    UsageTracker,
    UsageState,
} from "scorpio.ai";
import { inject } from "scorpio.di";

function formatSkillItems(skills: Skill[]): string {
  return skills
    .map(skill => {
      const usage = new UsageTracker(skill.path).get();
      const usageAttr = usage ? ` uses="${usage.useCount}" lastUsed="${usage.lastUsedAt ?? 'never'}"` : '';
      const typeAttr = skill.type ? ` type="${skill.type}"` : '';
      return `  <skill name="${skill.name}" path="${skill.path}"${typeAttr}${usageAttr}>${skill.description}</skill>`;
    })
    .join("\n");
}

export class SkillService implements IAgentPlugin {
  readonly name = "skills";
  readonly inheritToSubAgent = false;

  private skillsDirs: string[] = [];
  private singleSkillDirs: string[] = [];
  private logger;

  constructor(
    @inject(T_SkillSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("SkillService");
  }

  registerSkillsDir(dir: string): void {
    this.skillsDirs.push(dir);
  }

  registerSingleSkillDir(dir: string): void {
    this.singleSkillDirs.push(dir);
  }

  reset(): void {
    this.skillsDirs = [];
    this.singleSkillDirs = [];
  }

  getAllSkills(): Skill[] {
    const skills: Skill[] = [];
    const allSkillDirs: string[] = [...this.singleSkillDirs];
    for (const dir of this.skillsDirs) {
      if (!fs.existsSync(dir)) {
        this.logger?.debug(`技能目录不存在 ${dir}`);
        continue;
      }
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== '.archive') allSkillDirs.push(path.join(dir, entry.name));
        }
      } catch (e: any) {
        this.logger?.error(`读取技能目录失败 ${dir}: ${formatError(e, true)}`);
      }
    }

    for (const skillDir of allSkillDirs) {
      try {
        if (!isValidSkillDirectory(skillDir)) {
          this.logger?.warn(`技能目录无效: ${skillDir}`);
          continue
        }
        const skill = parseSkill(skillDir);
        if (!skill) {
          this.logger?.warn(`技能目录解析失败: ${skillDir}`);
          continue;
        }
        // 过滤 archived 状态的 skill
        const usage = new UsageTracker(skillDir).get();
        if (usage?.state === UsageState.Archived) continue;
        skills.push(skill);
      } catch (e: any) {
        this.logger?.error(`加载 skill 失败 ${skillDir}: ${formatError(e, true)}`);
      }
    }

    return skills;
  }

  async getStaticSystemPrompt(_ctx: AgentPluginContext): Promise<string | undefined> {
    if (!this.systemPromptTemplate) return undefined;
    const skills = this.getAllSkills();
    if (skills.length === 0) return undefined;

    return this.systemPromptTemplate.replace('{skills}', formatSkillItems(skills));
  }

}
