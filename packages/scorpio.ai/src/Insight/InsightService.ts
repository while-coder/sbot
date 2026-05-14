import { IInsightService } from "./IInsightService";
import { ILoggerService } from "../Logger";
import { IEmbeddingService } from "../Embedding";
import { inject, init, T_InsightToolCreateDesc, T_InsightToolPatchDesc, T_InsightToolDeleteDesc, T_InsightDir, T_InsightSystemPromptTemplate, T_InsightLimit, T_InsightStaleDays, T_InsightArchiveDays, T_InsightAutoExtract } from "../Core";
import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import yaml from "js-yaml";
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
import { UsageTracker } from "../Utils/UsageTracker";
import { PromptInjectionDetector, InjectionSeverity } from "../Utils/PromptInjectionDetector";
import { HybridSearcher } from "../Retrieval";
import { IInsightExtractor } from "./Extractor/IInsightExtractor";

export const INSIGHT_CREATE_TOOL_NAME = 'insight_create';
export const INSIGHT_PATCH_TOOL_NAME = 'insight_patch';
export const INSIGHT_DELETE_TOOL_NAME = 'insight_delete';

const toSearchable = (s: Skill) => ({ key: s.name, text: s.description });

export class InsightService implements IInsightService {
    private logger;
    private usageTracker = new UsageTracker();
    private injectionDetector = new PromptInjectionDetector();
    private searcher!: HybridSearcher;
    private autoExtract: boolean;

    constructor(
        @inject(T_InsightDir) private insightDir: string,
        @inject(T_InsightToolCreateDesc) private toolCreateDesc: string,
        @inject(T_InsightToolPatchDesc) private toolPatchDesc: string,
        @inject(T_InsightToolDeleteDesc) private toolDeleteDesc: string,
        @inject(T_InsightSystemPromptTemplate, { optional: true }) private systemPromptTemplate?: string,
        @inject(T_InsightLimit, { optional: true }) private insightLimit?: number,
        @inject(T_InsightStaleDays, { optional: true }) private staleDays?: number,
        @inject(T_InsightArchiveDays, { optional: true }) private archiveDays?: number,
        @inject(T_InsightAutoExtract, { optional: true }) autoExtract?: boolean,
        @inject(IInsightExtractor, { optional: true }) private extractor?: IInsightExtractor,
        @inject(IEmbeddingService, { optional: true }) private embeddings?: IEmbeddingService,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("InsightService");
        this.insightLimit ??= 5;
        this.staleDays ??= 30;
        this.archiveDays ??= 90;
        this.autoExtract = autoExtract !== false;
        this.searcher = new HybridSearcher({
            cachePath: path.join(this.insightDir, '.embeddings.json'),
        });
    }

    @init()
    async initialize(): Promise<void> {
        this.curate();
        if (this.embeddings) {
            try {
                const insights = this.getAllInsights();
                await this.searcher.buildIndex(insights.map(toSearchable), this.embeddings);
                this.logger?.info(`Insight embedding index built: ${insights.length} entries`);
            } catch (e: any) {
                this.logger?.error(`Failed to build insight embedding index: ${e.message}`);
            }
        }
    }

    getInsightDir(): string {
        return this.insightDir;
    }

    async extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void> {
        if (!this.autoExtract || !this.extractor) return;
        try {
            const insights = this.getAllInsights();
            const existingNames = insights.map(s => s.name);
            const extracted = await this.extractor.extract(userMessage, assistantMessages ?? [], existingNames);

            for (const item of extracted) {
                const detection = this.injectionDetector.detect(item.content);
                if (detection.severity === InjectionSeverity.BLOCK) {
                    this.logger?.warn(`Insight extraction blocked: injection detected in "${item.name}"`);
                    continue;
                }
                const safeContent = detection.severity === InjectionSeverity.WARN ? detection.sanitized : item.content;

                if (item.action === 'patch' && item.patchTarget) {
                    const existing = insights.find(s => s.name === item.patchTarget);
                    if (existing) {
                        const rebuilt = this.rebuildSkillMd(existing, safeContent, item.description);
                        fs.writeFileSync(path.join(existing.path, 'SKILL.md'), rebuilt, 'utf-8');
                        this.usageTracker.recordPatch(existing.path);
                        if (this.embeddings) {
                            try { await this.searcher.updateEntry(existing.name, item.description, this.embeddings); } catch { /* best-effort */ }
                        }
                        this.logger?.info(`Insight auto-patched: ${existing.name}`);
                        continue;
                    }
                }

                if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(item.name) && !/^[a-z0-9]$/.test(item.name)) {
                    this.logger?.warn(`Insight extraction skipped: invalid name "${item.name}"`);
                    continue;
                }
                const dir = path.join(this.insightDir, item.name);
                if (fs.existsSync(dir)) {
                    this.logger?.info(`Insight "${item.name}" already exists, skipping`);
                    continue;
                }

                fs.mkdirSync(dir, { recursive: true });
                const skillMd = `---\nname: ${item.name}\ntype: insight\ndescription: ${item.description}\n---\n\n${safeContent}`;
                fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd, 'utf-8');
                this.usageTracker.createUsage(dir, 'auto');
                if (this.embeddings) {
                    try { await this.searcher.updateEntry(item.name, item.description, this.embeddings); } catch { /* best-effort */ }
                }
                this.logger?.info(`Insight auto-created: ${item.name}`);
            }
        } catch (error: any) {
            this.logger?.error(`Insight extraction failed: ${error.message}`);
        }
    }

    getTools(): StructuredToolInterface[] {
        return [this.buildCreateTool(), this.buildPatchTool(), this.buildDeleteTool()];
    }

    async getRelevantInsights(query: string, limit?: number): Promise<string | null> {
        if (!this.systemPromptTemplate) return null;
        const max = limit ?? this.insightLimit!;
        const insights = this.getAllInsights();
        if (insights.length === 0) return null;

        let selected: Skill[];
        if (insights.length <= max) {
            selected = insights;
        } else {
            selected = await this.searcher.search(query, insights, toSearchable, max, this.embeddings);
        }

        if (selected.length === 0) return null;
        const items = selected.map(s => {
            const usage = this.usageTracker.getUsage(s.path);
            const usageAttr = usage ? ` uses="${usage.useCount}" lastUsed="${usage.lastUsedAt ?? 'never'}"` : '';
            return `  <insight name="${s.name}" path="${s.path}"${usageAttr}>${s.description}</insight>`;
        }).join("\n");
        return this.systemPromptTemplate.replace('{insights}', items);
    }

    // ── Curator ──

    private curate(): void {
        const insights = this.getAllInsights();
        for (const insight of insights) {
            const usage = this.usageTracker.getUsage(insight.path);
            if (!usage || usage.pinned) continue;
            const lastActivity = usage.lastUsedAt || usage.lastViewedAt || usage.createdAt;
            const daysSince = (Date.now() - new Date(lastActivity).getTime()) / 86400000;

            if (daysSince >= this.archiveDays!) {
                this.archiveInsight(insight, usage);
            } else if (daysSince >= this.staleDays! && usage.state === 'active') {
                usage.state = 'stale';
                fs.writeFileSync(path.join(insight.path, '.usage.json'), JSON.stringify(usage, null, 2), 'utf-8');
                this.logger?.info(`Insight marked stale: ${insight.name} (${Math.round(daysSince)}d inactive)`);
            }
        }
    }

    private archiveInsight(insight: Skill, usage: any): void {
        try {
            const archiveBase = path.join(this.insightDir, '.archive');
            if (!fs.existsSync(archiveBase)) fs.mkdirSync(archiveBase, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const archiveDest = path.join(archiveBase, `${insight.name}_${timestamp}`);
            fs.renameSync(insight.path, archiveDest);
            if (usage) {
                usage.state = 'archived';
                fs.writeFileSync(path.join(archiveDest, '.usage.json'), JSON.stringify(usage, null, 2), 'utf-8');
            }
            this.searcher.removeEntry(insight.name);
            this.logger?.info(`Insight auto-archived: ${insight.name} → ${archiveDest}`);
        } catch (e: any) {
            this.logger?.error(`Failed to auto-archive insight ${insight.name}: ${e.message}`);
        }
    }

    // ── Data Access ──

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

    // ── Tools ──

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

                    if (this.embeddings) {
                        try { await this.searcher.updateEntry(name, description, this.embeddings); } catch { /* best-effort */ }
                    }
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
                content: z.string().describe("New file content. For SKILL.md: body only (frontmatter is preserved automatically)"),
                description: z.string().optional().describe("Update the insight description (only applies to SKILL.md)"),
            }) as any,
            func: async ({ insightName, filePath, content, description }: any): Promise<MCPToolResult> => {
                try {
                    const insight = this.getAllInsights().find(s => s.name === insightName);
                    if (!insight) return createErrorResult(`Insight "${insightName}" not found`);

                    const fullPath = path.join(insight.path, filePath);
                    if (!this.isPathSafe(fullPath, insight.path)) return createErrorResult("Security error: access outside the insight directory is not allowed");

                    const dir = path.dirname(fullPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                    let finalContent = content;
                    if (filePath === 'SKILL.md') {
                        finalContent = this.rebuildSkillMd(insight, content, description);
                    }

                    fs.writeFileSync(fullPath, finalContent, 'utf-8');
                    this.usageTracker.recordPatch(insight.path);

                    if (filePath === 'SKILL.md' && this.embeddings) {
                        const updated = parseSkill(insight.path);
                        if (updated) {
                            try { await this.searcher.updateEntry(insightName, updated.description, this.embeddings); } catch { /* best-effort */ }
                        }
                    }

                    return createSuccessResult(createTextContent(`File "${filePath}" in insight "${insightName}" updated`));
                } catch (error: any) {
                    this.logger?.error(`Error patching insight ${insightName}/${filePath}: ${error.message}`);
                    return createErrorResult(error.message);
                }
            }
        });
    }

    private rebuildSkillMd(insight: Skill, content: string, newDescription?: string): string {
        const existing = fs.readFileSync(path.join(insight.path, 'SKILL.md'), 'utf-8');
        const fmMatch = existing.match(/^---\s*\n([\s\S]*?)\n---/);

        let frontmatter: Record<string, any>;
        if (fmMatch) {
            try {
                frontmatter = (yaml.load(fmMatch[1]) as Record<string, any>) ?? {};
            } catch {
                frontmatter = {};
            }
        } else {
            frontmatter = {};
        }

        frontmatter.name = insight.name;
        frontmatter.type = frontmatter.type || 'insight';
        if (newDescription) frontmatter.description = newDescription;
        frontmatter.description ??= insight.name;

        const body = this.stripFrontmatter(content);
        return `---\n${yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd()}\n---\n\n${body}`;
    }

    private stripFrontmatter(content: string): string {
        const trimmed = content.trimStart();
        if (!trimmed.startsWith('---')) return content;
        const end = trimmed.indexOf('\n---', 3);
        if (end === -1) return content;
        return trimmed.slice(end + 4).trimStart();
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

                    this.searcher.removeEntry(insightName);
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
