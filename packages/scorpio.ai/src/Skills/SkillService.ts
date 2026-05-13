import { Skill } from "./types";
import { parseSkill, isValidSkillDirectory } from "./parser";
import { ISkillService } from "./ISkillService";
import { ILoggerService } from "../Logger";
import { inject, T_SkillSystemPromptTemplate, T_SkillToolReadDesc, T_SkillToolListDesc, T_SkillToolExecDesc } from "../Core";
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
import { SkillUsageTracker } from "./SkillUsageTracker";

const execAsync = promisify(exec);

export const READ_SKILL_FILE_TOOL_NAME = 'read_skill_file';
export const EXECUTE_SKILL_SCRIPT_TOOL_NAME = 'execute_skill_script';
export const LIST_SKILL_FILES_TOOL_NAME = 'list_skill_files';

export class SkillService implements ISkillService {
  private skillsDirs: string[] = [];
  private singleSkillDirs: string[] = [];
  private logger;
  private usageTracker = new SkillUsageTracker();

  constructor(
    @inject(T_SkillSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_SkillToolReadDesc) private toolReadDesc: string,
    @inject(T_SkillToolListDesc) private toolListDesc: string,
    @inject(T_SkillToolExecDesc) private toolExecDesc: string,
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
        this.logger?.error(`读取技能目录失败 ${dir}: ${e.message}`);
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
        const usage = this.usageTracker.getUsage(skillDir);
        if (usage?.state === 'archived') continue;
        skills.push(skill);
      } catch (e: any) {
        this.logger?.error(`加载 skill 失败 ${skillDir}: ${e.message}`);
      }
    }

    return skills;
  }

  async getSystemMessage(): Promise<string | null> {
    if (!this.systemPromptTemplate) return null;
    const skills = this.getAllSkills();
    if (skills.length === 0) return null;

    const items = skills
      .map(s => {
        const usage = this.usageTracker.getUsage(s.path);
        const usageAttr = usage ? ` uses="${usage.useCount}" lastUsed="${usage.lastUsedAt ?? 'never'}"` : '';
        return `  <skill name="${s.name}" path="${s.path}"${usageAttr}>${s.description}</skill>`;
      })
      .join("\n");

    return this.systemPromptTemplate.replace('{skills}', items);
  }

  getTools(): StructuredToolInterface[] {
    if (this.getAllSkills().length === 0) return [];
    if (!this.toolReadDesc) return [];
    return [this.buildReadTool(), this.buildExecTool(), this.buildListTool()];
  }

  // ── 基础工具（读/执行/列表） ──

  private buildReadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
      name: READ_SKILL_FILE_TOOL_NAME,
      description: this.toolReadDesc,
      schema: z.object({
        skillName: z.string().describe("Skill name (kebab-case)"),
        filePath: z.string().describe('Relative path within the skill directory, e.g. "SKILL.md", "scripts/init.py"')
      }) as any,
      func: async ({ skillName, filePath }: any): Promise<MCPToolResult> => {
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) return createErrorResult(`Skill "${skillName}" not found`);

          const fullPath = path.join(skill.path, filePath);
          if (!this.isPathSafe(fullPath, skill.path)) return createErrorResult("Security error: access outside the skill directory is not allowed");
          if (!fs.existsSync(fullPath)) return createErrorResult(`File not found: ${filePath}`);
          if (!fs.statSync(fullPath).isFile()) return createErrorResult(`Path is not a file: ${filePath}`);

          this.usageTracker.recordView(skill.path);
          const content = fs.readFileSync(fullPath, "utf-8");
          return createSuccessResult(createTextContent(content));
        } catch (error: any) {
          this.logger?.error(`Error reading skill file ${skillName}/${filePath}: ${error.message}`);
          return createErrorResult(error.message);
        }
      }
    });
  }

  private buildExecTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
      name: EXECUTE_SKILL_SCRIPT_TOOL_NAME,
      description: this.toolExecDesc!,
      schema: z.object({
        skillName: z.string().describe("Skill name (kebab-case)"),
        scriptPath: z.string().describe('Relative path to the script, e.g. "scripts/process.py". Confirm via list_skill_files first.'),
        args: z.array(z.string()).optional().describe("Arguments to pass to the script")
      }) as any,
      func: async ({ skillName, scriptPath, args = [] }: any): Promise<MCPToolResult> => {
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) return createErrorResult(`Skill "${skillName}" not found`);

          const fullPath = path.join(skill.path, scriptPath);
          if (!this.isPathSafe(fullPath, skill.path)) return createErrorResult("Security error: executing scripts outside the skill directory is not allowed");
          if (!fs.existsSync(fullPath)) return createErrorResult(`Script not found: ${scriptPath}`);

          const ext = path.extname(scriptPath).toLowerCase();
          let command = "";
          switch (ext) {
            case ".py":  command = `python "${fullPath}" ${args.join(" ")}`; break;
            case ".sh":  command = `bash "${fullPath}" ${args.join(" ")}`; break;
            case ".js":  command = `node "${fullPath}" ${args.join(" ")}`; break;
            case ".ts":  command = `ts-node "${fullPath}" ${args.join(" ")}`; break;
            default: return createErrorResult(`Unsupported script type: ${ext}. Supported: .py, .sh, .js, .ts`);
          }

          this.usageTracker.recordUse(skill.path);
          const { stdout, stderr } = await execAsync(command, { cwd: skill.path, env: process.env, timeout: 60000, maxBuffer: 10 * 1024 * 1024 });

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
  }

  private buildListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
      name: LIST_SKILL_FILES_TOOL_NAME,
      description: this.toolListDesc!,
      schema: z.object({
        skillName: z.string().describe("Skill name (kebab-case)"),
        subPath: z.string().optional().describe('Optional sub-path, e.g. "scripts", "references"')
      }) as any,
      func: async ({ skillName, subPath = "" }: any): Promise<MCPToolResult> => {
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) return createErrorResult(`Skill "${skillName}" not found`);

          const fullPath = path.join(skill.path, subPath);
          if (!this.isPathSafe(fullPath, skill.path)) return createErrorResult("Security error: access outside the skill directory is not allowed");
          if (!fs.existsSync(fullPath)) return createErrorResult(`Directory not found: ${subPath || "/"}`);

          const structure = this.getDirectoryStructure(fullPath);
          return createSuccessResult(createTextContent(structure.join("\n")));
        } catch (error: any) {
          this.logger?.error(`Error listing skill files ${skillName}/${subPath}: ${error.message}`);
          return createErrorResult(error.message);
        }
      }
    });
  }

  // ── 工具函数 ──

  private isPathSafe(fullPath: string, baseDir: string): boolean {
    return path.normalize(fullPath).startsWith(path.normalize(baseDir));
  }

  private getDirectoryStructure(dirPath: string, prefix = ""): string[] {
    const items: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.forEach((entry, index) => {
      if (entry.name === '.usage.json') return;
      const isLast = index === entries.length - 1;
      const marker = isLast ? "└─" : "├─";
      const nextPrefix = prefix + (isLast ? "  " : "│ ");
      if (entry.isDirectory()) {
        items.push(`${prefix}${marker} ${entry.name}/`);
        items.push(...this.getDirectoryStructure(path.join(dirPath, entry.name), nextPrefix));
      } else {
        const stat = fs.statSync(path.join(dirPath, entry.name));
        const sizeStr = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`;
        items.push(`${prefix}${marker} ${entry.name} (${sizeStr})`);
      }
    });
    return items;
  }
}
