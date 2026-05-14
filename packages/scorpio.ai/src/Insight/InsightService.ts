import { IInsightService } from "./IInsightService";
import { ILoggerService } from "../Logger";
import { inject, T_InsightToolCreateDesc, T_InsightToolPatchDesc, T_InsightToolDeleteDesc, T_InsightDir } from "../Core";
import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs";
import path from "path";
import {
    createTextContent,
    createErrorResult,
    createSuccessResult,
    MCPToolResult
} from "../Tools";
import { parseSkill, isValidSkillDirectory } from "../Skills/parser";
import { Skill } from "../Skills/types";
import { SkillUsageTracker } from "../Skills/SkillUsageTracker";
import { PromptInjectionDetector, InjectionSeverity } from "../Utils/PromptInjectionDetector";

export const INSIGHT_CREATE_TOOL_NAME = 'insight_create';
export const INSIGHT_PATCH_TOOL_NAME = 'insight_patch';
export const INSIGHT_DELETE_TOOL_NAME = 'insight_delete';

export class InsightService implements IInsightService {
    private logger;
    private usageTracker = new SkillUsageTracker();
    private injectionDetector = new PromptInjectionDetector();

    constructor(
        @inject(T_InsightDir) private insightDir: string,
        @inject(T_InsightToolCreateDesc) private toolCreateDesc: string,
        @inject(T_InsightToolPatchDesc) private toolPatchDesc: string,
        @inject(T_InsightToolDeleteDesc) private toolDeleteDesc: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("InsightService");
    }

    getInsightDir(): string {
        return this.insightDir;
    }

    getTools(): StructuredToolInterface[] {
        return [this.buildCreateTool(), this.buildPatchTool(), this.buildDeleteTool()];
    }

    private getAllInsights(): Skill[] {
        const insights: Skill[] = [];
        if (!fs.existsSync(this.insightDir)) return insights;
        try {
            for (const entry of fs.readdirSync(this.insightDir, { withFileTypes: true })) {
                if (!entry.isDirectory() || entry.name === '.archive') continue;
                const dir = path.join(this.insightDir, entry.name);
                if (!isValidSkillDirectory(dir)) continue;
                const insight = parseSkill(dir);
                if (!insight) continue;
                const usage = this.usageTracker.getUsage(dir);
                if (usage?.state === 'archived') continue;
                insights.push(insight);
            }
        } catch (e: any) {
            this.logger?.error(`读取 insight 目录失败 ${this.insightDir}: ${e.message}`);
        }
        return insights;
    }

    private buildCreateTool(): StructuredToolInterface {
        return new DynamicStructuredTool({
            name: INSIGHT_CREATE_TOOL_NAME,
            description: this.toolCreateDesc,
            schema: z.object({
                name: z.string().describe("Insight name in kebab-case (e.g. 'api-error-handling', 'data-pipeline-pattern')"),
                description: z.string().describe("Brief description of this insight"),
                content: z.string().describe("SKILL.md body content (markdown). Frontmatter will be auto-generated."),
            }) as any,
            func: async ({ name, description, content }: any): Promise<MCPToolResult> => {
                try {
                    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && !/^[a-z0-9]$/.test(name)) {
                        return createErrorResult("Invalid insight name: must be kebab-case (lowercase letters, numbers, hyphens)");
                    }
                    const detection = this.injectionDetector.detect(content);
                    if (detection.severity === InjectionSeverity.BLOCK) {
                        return createErrorResult(`Content rejected: detected suspicious patterns: ${detection.patterns.join(', ')}`);
                    }
                    const safeContent = detection.severity === InjectionSeverity.WARN ? detection.sanitized : content;

                    const dir = path.join(this.insightDir, name);
                    if (fs.existsSync(dir)) return createErrorResult(`Insight "${name}" already exists`);

                    fs.mkdirSync(dir, { recursive: true });
                    const skillMd = `---\nname: ${name}\ntype: insight\ndescription: ${description}\n---\n\n${safeContent}`;
                    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd, 'utf-8');
                    this.usageTracker.createUsage(dir, 'agent');

                    this.logger?.info(`Insight created: ${name} at ${dir}`);
                    return createSuccessResult(createTextContent(`Insight "${name}" created at ${dir}`));
                } catch (error: any) {
                    this.logger?.error(`Error creating insight ${name}: ${error.message}`);
                    return createErrorResult(error.message);
                }
            }
        });
    }

    private buildPatchTool(): StructuredToolInterface {
        return new DynamicStructuredTool({
            name: INSIGHT_PATCH_TOOL_NAME,
            description: this.toolPatchDesc,
            schema: z.object({
                insightName: z.string().describe("Insight name (kebab-case)"),
                filePath: z.string().describe('Relative file path within insight directory (e.g. "SKILL.md")'),
                content: z.string().describe("New file content (full replacement)"),
            }) as any,
            func: async ({ insightName, filePath, content }: any): Promise<MCPToolResult> => {
                try {
                    const insight = this.getAllInsights().find(s => s.name === insightName);
                    if (!insight) return createErrorResult(`Insight "${insightName}" not found`);

                    const fullPath = path.join(insight.path, filePath);
                    if (!this.isPathSafe(fullPath, insight.path)) return createErrorResult("Security error: access outside the insight directory is not allowed");

                    const dir = path.dirname(fullPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                    fs.writeFileSync(fullPath, content, 'utf-8');
                    this.usageTracker.recordPatch(insight.path);

                    return createSuccessResult(createTextContent(`File "${filePath}" in insight "${insightName}" updated`));
                } catch (error: any) {
                    this.logger?.error(`Error patching insight ${insightName}/${filePath}: ${error.message}`);
                    return createErrorResult(error.message);
                }
            }
        });
    }

    private buildDeleteTool(): StructuredToolInterface {
        return new DynamicStructuredTool({
            name: INSIGHT_DELETE_TOOL_NAME,
            description: this.toolDeleteDesc,
            schema: z.object({
                insightName: z.string().describe("Insight name (kebab-case)"),
            }) as any,
            func: async ({ insightName }: any): Promise<MCPToolResult> => {
                try {
                    const insight = this.getAllInsights().find(s => s.name === insightName);
                    if (!insight) return createErrorResult(`Insight "${insightName}" not found`);

                    const archiveBase = path.join(this.insightDir, '.archive');
                    if (!fs.existsSync(archiveBase)) fs.mkdirSync(archiveBase, { recursive: true });

                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const archiveDest = path.join(archiveBase, `${insightName}_${timestamp}`);
                    fs.renameSync(insight.path, archiveDest);

                    const usage = this.usageTracker.getUsage(archiveDest);
                    if (usage) {
                        usage.state = 'archived';
                        fs.writeFileSync(path.join(archiveDest, '.usage.json'), JSON.stringify(usage, null, 2), 'utf-8');
                    }

                    this.logger?.info(`Insight archived: ${insightName} → ${archiveDest}`);
                    return createSuccessResult(createTextContent(`Insight "${insightName}" archived to ${archiveDest}`));
                } catch (error: any) {
                    this.logger?.error(`Error deleting insight ${insightName}: ${error.message}`);
                    return createErrorResult(error.message);
                }
            }
        });
    }

    private isPathSafe(fullPath: string, baseDir: string): boolean {
        return path.normalize(fullPath).startsWith(path.normalize(baseDir));
    }
}
