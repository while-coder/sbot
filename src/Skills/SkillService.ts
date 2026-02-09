import { Skill } from "./types";
import { loadSkills } from "./loader";
import { LoggerService } from "../LoggerService";
import { ISkillService } from "./ISkillService";

const logger = LoggerService.getLogger("SkillService.ts");

/**
 * Skill 服务
 * 管理技能的加载、查询和访问
 */
export class SkillService implements ISkillService {
  private skills: Skill[] = [];
  private skillsDir?: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir;
    if (skillsDir) {
      this.skills = loadSkills(skillsDir);
    } else {
      logger.warn("技能服务已初始化（未配置技能目录）");
    }
  }

  /**
   * 获取所有已加载的技能
   */
  getAllSkills(): Skill[] {
    return this.skills;
  }

  /**
   * 获取 Skills 系统提示词
   * 用于注入到 Agent 的系统消息中
   */
  getSystemMessage(): string | null {
    if (this.skills.length === 0) {
      return null;
    }

    const skillsList = this.skills.map(skill =>
      `- ${skill.name}: ${skill.path}\n  ${skill.description}`
    ).join('\n');

    return `
# Skills 系统

你拥有一套专为特定任务优化的 **Skills**。当用户的请求与下列任意 skill 的描述相关时，你**必须立即使用**对应的 skill。

## 可用的 Skills 列表

${skillsList}

**Skills 存储路径**: ${this.skillsDir}

---

## 识别与匹配规则

**关键原则**: 根据用户请求的**关键词、任务类型、文件类型**来匹配 skill。

## 使用流程（必须遵守）

当匹配到 skill 时，立即执行以下步骤：

1. **告知用户**："我将使用 '{skill-name}' skill 来处理这个任务"
2. **读取 SKILL.md**：使用 \`read_skill_file\` 工具读取 SKILL.md 文件
   - skillName: skill 名称
   - filePath: "SKILL.md"
3. **理解指导**：仔细阅读 SKILL.md 中的完整工作流程和指导说明
4. **严格执行**：完全按照 skill 中的指导和步骤来完成任务
5. **访问资源**：如果 skill 引用了其他文件，使用以下工具：
   - \`list_skill_files\`: 查看 skill 目录结构
   - \`read_skill_file\`: 读取 skill 目录下的任何文件
   - \`execute_skill_script\`: 执行 skill 中的脚本（.py, .sh, .js, .ts）

## 可用的 Skill 工具

你有以下工具来操作 skills：

- **read_skill_file**: 读取 skill 目录下的任何文件（SKILL.md、scripts/、references/ 等）
- **list_skill_files**: 列出 skill 的目录结构，查看包含哪些文件
- **execute_skill_script**: 执行 skill 中的脚本文件

## 重要约束

- 必须使用 \`read_skill_file\` 工具读取文件，不要尝试猜测文件内容
- 在执行任何 skill 相关操作前，必须先读取并理解 SKILL.md
- SKILL.md 中的指导是权威的，必须完全遵守
- 不要等用户明确说"使用某个 skill"，要主动识别和使用
- 如果不确定 skill 的使用方式，必须先读取 SKILL.md`;
  }
}
