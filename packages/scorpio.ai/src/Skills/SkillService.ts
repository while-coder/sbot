import { Skill } from "./types";
import { parseSkill, isValidSkillDirectory } from "./parser";
import { formatSkillItems } from "./formatSkillItems";
import { ISkillService } from "./ISkillService";
import { ILoggerService } from "../Logger";
import { inject, T_SkillSystemPromptTemplate, T_SkillToolReadDesc, T_SkillToolListDesc, T_SkillToolExecDesc } from "../Core";
import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs";
import path from "path";
import {
    createTextContent,
    createErrorResult,
    createSuccessResult,
    MCPToolResult,
    runShellCommand,
    formatWalkTree,
    DEFAULT_WALK_MAX_DEPTH,
    DEFAULT_WALK_LIMIT,
} from "../Tools";
import { UsageTracker, UsageState } from "../Utils/UsageTracker";

export const READ_SKILL_FILE_TOOL_NAME = 'read_skill_file';
export const EXECUTE_SKILL_SCRIPT_TOOL_NAME = 'execute_skill_script';
export const LIST_SKILL_FILES_TOOL_NAME = 'list_skill_files';

export class SkillService implements ISkillService {
  private skillsDirs: string[] = [];
  private singleSkillDirs: string[] = [];
  private logger;

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
        const usage = new UsageTracker(skillDir).get();
        if (usage?.state === UsageState.Archived) continue;
        skills.push(skill);
      } catch (e: any) {
        this.logger?.error(`加载 skill 失败 ${skillDir}: ${e.message}`);
      }
    }

    return skills;
  }

  async getSystemMessage(): Promise<string | null> {
    if (!this.systemPromptTemplate) return null;
    const skills = this.getAllSkills().filter(s => s.type !== 'insight');
    if (skills.length === 0) return null;

    return this.systemPromptTemplate.replace('{skills}', formatSkillItems(skills));
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

          new UsageTracker(skill.path).recordView();
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
        skillName:  z.string().describe("Skill name (kebab-case)"),
        command:    z.string().min(1).describe('Shell command or multi-line script to run inside the skill, e.g. "python scripts/process.py --in data.json", "npm install && npm run build". Relative paths resolve against workingDir.'),
        workingDir: z.string().optional().describe('Optional sub-directory inside the skill to use as cwd, relative to the skill root (e.g. "scripts"). Defaults to the skill root. Use this for scripts that assume their own directory as cwd.'),
        stdin:      z.any().optional().describe('Data to pipe into the command via stdin. Prefer a string; objects/arrays are auto-serialized to JSON.'),
        timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
      }) as any,
      func: async ({ skillName, command, workingDir, stdin, timeout = 60000 }: any): Promise<MCPToolResult> => {
        // schema 用 z.any() 是为了同时满足两点：(1) Zod v4 的 toJSONSchema 不接受 transform/preprocess；
        // (2) 模型偶尔不遵守 string 约束、直接塞 object/array。这里在 func 入口统一序列化兜底。
        if (stdin != null && typeof stdin !== 'string') stdin = JSON.stringify(stdin);
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) return createErrorResult(`Skill "${skillName}" not found`);

          // 默认 cwd = skill 根；workingDir 用 path.resolve 处理，绝对路径会覆盖 base，
          // 再用 isPathSafe 兜底拦截 ".."/绝对路径越权，保持 skill 边界。
          const cwd = workingDir ? path.resolve(skill.path, workingDir) : skill.path;
          if (!this.isPathSafe(cwd, skill.path)) {
            return createErrorResult("Security error: workingDir must be inside the skill directory");
          }
          if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
            return createErrorResult(`Working directory not found: ${cwd}`);
          }

          new UsageTracker(skill.path).recordUse();
          const label = `skill ${skillName}`;
          this.logger?.info(`执行 skill ${skillName} (cwd=${cwd}): ${command}`);

          return await runShellCommand(command, cwd, timeout, label, stdin);
        } catch (error: any) {
          this.logger?.error(`Error executing skill ${skillName}: ${error.message}`);
          return createErrorResult(`Error: ${error.message}`);
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
        subPath:   z.string().optional().describe('Sub-directory to list, relative to the skill root (e.g. "scripts", "references"). Defaults to the skill root.'),
        maxDepth:  z.number().int().positive().optional().default(DEFAULT_WALK_MAX_DEPTH).describe(`Max recursion depth (1 = direct children only). Default ${DEFAULT_WALK_MAX_DEPTH}`),
        limit:     z.number().int().positive().optional().default(DEFAULT_WALK_LIMIT).describe(`Stop after this many entries (files + directories). Default ${DEFAULT_WALK_LIMIT}`),
        ignore:    z.array(z.string()).optional().describe('Additional directory/file names to ignore'),
      }) as any,
      func: async ({ skillName, subPath = "", maxDepth = DEFAULT_WALK_MAX_DEPTH, limit = DEFAULT_WALK_LIMIT, ignore = [] }: any): Promise<MCPToolResult> => {
        try {
          const skill = this.getAllSkills().find(s => s.name === skillName);
          if (!skill) return createErrorResult(`Skill "${skillName}" not found`);

          const fullPath = path.join(skill.path, subPath);
          if (!this.isPathSafe(fullPath, skill.path)) return createErrorResult("Security error: access outside the skill directory is not allowed");
          if (!fs.existsSync(fullPath)) return createErrorResult(`Directory not found: ${subPath || "/"}`);

          const ignoreSet = new Set<string>([...SkillService.IGNORED_NAMES, ...(ignore ?? [])]);
          return createSuccessResult(createTextContent(formatWalkTree(fullPath, { maxDepth, limit, ignore: ignoreSet })));
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

  // 扁平路径列表：目录用 `/` 后缀标识，省 token、无歧义。目录优先排序便于 LLM 识别可下钻路径。
  // 过滤构建产物 / VCS / IDE / 内部缓存噪音，避免顶层出现 node_modules 这类条目。
  private static readonly IGNORED_NAMES = new Set([
    '.usage.json',
    // VCS
    '.git', '.svn', '.hg',
    // Node
    'node_modules', 'coverage', '.next', '.nuxt', '.turbo',
    // Python
    '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.tox', '.ruff_cache',
    // 其他构建产物
    'target', '.gradle',
    // IDE / OS
    '.idea', '.vscode', '.DS_Store', 'Thumbs.db',
    // skill 自身的运行时/缓存/临时目录（约定俗成的 dot-prefixed 内部目录）
    '.runtime', '.cache', '.tmp', '.temp', '.local',
  ]);
}
