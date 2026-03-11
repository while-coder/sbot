import { Skill } from "./types";
import { parseSkill, isValidSkillDirectory } from "./parser";
import { ISkillService } from "./ISkillService";
import { ILoggerService } from "../Logger";
import { inject } from "../Core";
import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import {
    createTextContent,
    createErrorResult,
    createSuccessResult,
    MCPToolResult
} from "../Tools";

const execAsync = promisify(exec);

/**
 * Skill 服务
 * 管理技能的加载、查询和访问
 *
 * 调用 registerSkillsDir() 注册目录，支持两种目录类型：
 * - skillsDirs: 包含多个 skill 子目录的父目录
 * - singleSkillDirs: 单个 skill 目录（直接指向 skill 根目录）
 *
 * 技能延迟加载：首次调用 getAllSkills() 时扫描目录。
 */
export class SkillService implements ISkillService {
  private _skills: Skill[] | null = null;
  private skillsDirs: string[] = [];
  private singleSkillDirs: string[] = [];
  private logger;

  constructor(
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("SkillService");
  }

  /**
   * 注册父目录（目录内每个子目录为一个 skill）
   */
  registerSkillsDir(dir: string): void {
    this.skillsDirs.push(dir);
    this._skills = null;
  }

  /**
   * 注册单个 skill 目录（目录本身即为一个 skill 根目录）
   */
  registerSingleSkillDir(dir: string): void {
    this.singleSkillDirs.push(dir);
    this._skills = null;
  }

  /**
   * 重置所有已注册目录和缓存
   */
  reset(): void {
    this.skillsDirs = [];
    this.singleSkillDirs = [];
    this._skills = null;
  }

  /**
   * 获取所有已加载的技能（延迟加载，首次调用时扫描目录）
   */
  getAllSkills(): Skill[] {
    if (this._skills !== null) return this._skills;

    this._skills = [];

    // 收集所有 skill 目录
    const allSkillDirs: string[] = [...this.singleSkillDirs];
    for (const dir of this.skillsDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) allSkillDirs.push(path.join(dir, entry.name));
        }
      } catch (e: any) {
        this.logger?.error(`读取技能目录失败 ${dir}: ${e.message}`);
      }
    }

    // 逐个加载
    for (const skillDir of allSkillDirs) {
      try {
        const skill = isValidSkillDirectory(skillDir) ? parseSkill(skillDir) : null;
        if (skill) this._skills.push(skill);
      } catch (e: any) {
        this.logger?.error(`加载 skill 失败 ${skillDir}: ${e.message}`);
      }
    }

    return this._skills;
  }

  /**
   * 获取 Skills 系统提示词
   * 用于注入到 Agent 的系统消息中
   */
  async getSystemMessage(): Promise<string | null> {
    const skills = this.getAllSkills();
    if (skills.length === 0) return null;

    const items = skills
      .map(s => `  <skill name="${s.name}" path="${s.path}">${s.description}</skill>`)
      .join("\n");

    return `<skills>
${items}
</skills>

When a user request matches any skill above, you MUST use it immediately.

Matching: match by keywords, task type, or file type in the user's request.

Workflow:
1. Inform the user: "I'll use the '{skill-name}' skill for this task"
2. Call \`list_skill_files\` to inspect the skill directory structure
3. Call \`read_skill_file\` to read SKILL.md
4. Follow the instructions in SKILL.md strictly
5. Use \`read_skill_file\` / \`execute_skill_script\` for any referenced files or scripts

Available tools:
- \`read_skill_file\` — read any file in the skill directory
- \`list_skill_files\` — list the skill directory tree
- \`execute_skill_script\` — run a script (.py, .sh, .js, .ts)

Constraints:
- Always read SKILL.md before performing any skill-related action
- SKILL.md instructions are authoritative — follow them completely
- Proactively identify and use matching skills without waiting for explicit user requests`;
  }

  /**
   * 获取 Skill 相关的工具
   */
  getTools(): StructuredToolInterface[] {
    if (this.getAllSkills().length === 0) {
      return [];
    }

    // Read skill file tool
    const readSkillFileTool = new DynamicStructuredTool({
      name: "read_skill_file",
      description: "Read a file from a skill directory (SKILL.md, scripts/, references/, assets/, etc.).",
      schema: z.object({
        skillName: z.string().describe("Skill name (kebab-case)"),
        filePath: z.string().describe('Relative path within the skill directory, e.g. "SKILL.md", "scripts/init.py"')
      }) as any,
      func: async ({ skillName, filePath }: any): Promise<MCPToolResult> => {
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) {
            return createErrorResult(`Skill "${skillName}" not found`);
          }

          const skillDir = skill.path;
          const fullPath = path.join(skillDir, filePath);

          const normalizedPath = path.normalize(fullPath);
          const normalizedSkillDir = path.normalize(skillDir);
          if (!normalizedPath.startsWith(normalizedSkillDir)) {
            return createErrorResult("Security error: access outside the skill directory is not allowed");
          }

          if (!fs.existsSync(fullPath)) {
            return createErrorResult(`File not found: ${filePath}`);
          }

          if (!fs.statSync(fullPath).isFile()) {
            return createErrorResult(`Path is not a file: ${filePath}`);
          }

          const content = fs.readFileSync(fullPath, "utf-8");
          return createSuccessResult(createTextContent(content));
        } catch (error: any) {
          this.logger?.error(`Error reading skill file ${skillName}/${filePath}: ${error.message}`);
          return createErrorResult(error.message);
        }
      }
    });

    // Execute skill script tool
    const executeSkillScriptTool = new DynamicStructuredTool({
      name: "execute_skill_script",
      description: "Execute a script in a skill directory (Python, Shell, Node.js, TypeScript). Runs with the skill directory as cwd. Use list_skill_files first to confirm the script path.",
      schema: z.object({
        skillName: z.string().describe("Skill name (kebab-case)"),
        scriptPath: z.string().describe('Relative path to the script, e.g. "scripts/process.py". Confirm via list_skill_files first.'),
        args: z.array(z.string()).optional().describe("Arguments to pass to the script")
      }) as any,
      func: async ({ skillName, scriptPath, args = [] }: any): Promise<MCPToolResult> => {
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) {
            return createErrorResult(`Skill "${skillName}" not found`);
          }

          const skillDir = skill.path;
          const fullPath = path.join(skillDir, scriptPath);

          const normalizedPath = path.normalize(fullPath);
          if (!normalizedPath.startsWith(path.normalize(skillDir))) {
            return createErrorResult("Security error: executing scripts outside the skill directory is not allowed");
          }

          if (!fs.existsSync(fullPath)) {
            return createErrorResult(`Script not found: ${scriptPath}`);
          }

          const ext = path.extname(scriptPath).toLowerCase();
          let command = "";

          switch (ext) {
            case ".py":
              command = `python "${fullPath}" ${args.join(" ")}`;
              break;
            case ".sh":
              command = `bash "${fullPath}" ${args.join(" ")}`;
              break;
            case ".js":
              command = `node "${fullPath}" ${args.join(" ")}`;
              break;
            case ".ts":
              command = `ts-node "${fullPath}" ${args.join(" ")}`;
              break;
            default:
              return createErrorResult(`Unsupported script type: ${ext}. Supported: .py, .sh, .js, .ts`);
          }

          const { stdout, stderr } = await execAsync(command, {
            cwd: skillDir,
            env: process.env,
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024
          });

          const result = [];
          if (stdout.trim()) result.push(createTextContent(stdout.trim()));
          if (stderr.trim()) result.push(createTextContent(`stderr:\n${stderr.trim()}`));
          return createSuccessResult(...result);
        } catch (error: any) {
          this.logger?.error(`Error executing skill script ${skillName}/${scriptPath}: ${error.message}`);

          const errorDetails = [createTextContent(`Error: ${error.message}`)];
          if (error.stdout?.trim()) errorDetails.push(createTextContent(`stdout:\n${error.stdout.trim()}`));
          if (error.stderr?.trim()) errorDetails.push(createTextContent(`stderr:\n${error.stderr.trim()}`));

          return { content: errorDetails, isError: true };
        }
      }
    });

    // List skill files tool
    const listSkillFilesTool = new DynamicStructuredTool({
      name: "list_skill_files",
      description: "List the directory tree of a skill. Use to discover available files and resources.",
      schema: z.object({
        skillName: z.string().describe("Skill name (kebab-case)"),
        subPath: z.string().optional().describe('Optional sub-path, e.g. "scripts", "references"')
      }) as any,
      func: async ({ skillName, subPath = "" }: any): Promise<MCPToolResult> => {
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) {
            return createErrorResult(`Skill "${skillName}" not found`);
          }

          const skillDir = skill.path;
          const fullPath = path.join(skillDir, subPath);

          if (!path.normalize(fullPath).startsWith(path.normalize(skillDir))) {
            return createErrorResult("Security error: access outside the skill directory is not allowed");
          }

          if (!fs.existsSync(fullPath)) {
            return createErrorResult(`Directory not found: ${subPath || "/"}`);
          }

          const getDirectoryStructure = (dirPath: string, prefix = ""): string[] => {
            const items: string[] = [];
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            entries.forEach((entry, index) => {
              const isLast = index === entries.length - 1;
              const marker = isLast ? "└─" : "├─";
              const nextPrefix = prefix + (isLast ? "  " : "│ ");

              if (entry.isDirectory()) {
                items.push(`${prefix}${marker} ${entry.name}/`);
                const subItems = getDirectoryStructure(path.join(dirPath, entry.name), nextPrefix);
                items.push(...subItems);
              } else {
                const filePath = path.join(dirPath, entry.name);
                const stat = fs.statSync(filePath);
                const size = stat.size;
                const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
                items.push(`${prefix}${marker} ${entry.name} (${sizeStr})`);
              }
            });

            return items;
          };

          const structure = getDirectoryStructure(fullPath);
          return createSuccessResult(createTextContent(structure.join("\n")));
        } catch (error: any) {
          this.logger?.error(`Error listing skill files ${skillName}/${subPath}: ${error.message}`);
          return createErrorResult(error.message);
        }
      }
    });

    return [readSkillFileTool, executeSkillScriptTool, listSkillFilesTool];
  }
}
