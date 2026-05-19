import { IInsightService } from "./IInsightService";
import { ILoggerService } from "../Logger";
import { IEmbeddingService } from "../Embedding";
import { inject, init, T_InsightDir, T_InsightSystemPromptTemplate, T_InsightLimit, T_InsightStaleDays, T_InsightArchiveDays } from "../Core";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { parseSkill, isValidSkillDirectory } from "../Skills/parser";
import { Skill } from "../Skills/types";
import { UsageTracker } from "../Utils/UsageTracker";
import { HybridSearcher } from "../Retrieval";
import { IInsightExtractor } from "./Extractor/IInsightExtractor";

const toSearchable = (s: Skill) => ({ key: s.name, text: s.description });

export class InsightService implements IInsightService {
    private logger;
    private usageTracker = new UsageTracker();
    private searcher!: HybridSearcher;

    constructor(
        @inject(T_InsightDir) private insightDir: string,
        @inject(T_InsightSystemPromptTemplate) private systemPromptTemplate: string,
        @inject(IInsightExtractor) private extractor: IInsightExtractor,
        @inject(T_InsightLimit, { optional: true }) private insightLimit?: number,
        @inject(T_InsightStaleDays, { optional: true }) private staleDays?: number,
        @inject(T_InsightArchiveDays, { optional: true }) private archiveDays?: number,
        @inject(IEmbeddingService, { optional: true }) private embeddings?: IEmbeddingService,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("InsightService");
        this.insightLimit ??= 5;
        this.staleDays ??= 30;
        this.archiveDays ??= 90;
        this.searcher = new HybridSearcher({
            cachePath: path.join(this.insightDir, '.embeddings.json'),
        });
    }

    @init()
    async initialize(): Promise<void> {
        this.logger?.debug(`initialize: insightDir=${this.insightDir}, limit=${this.insightLimit}, staleDays=${this.staleDays}, archiveDays=${this.archiveDays}, hasEmbeddings=${!!this.embeddings}`);
        this.curate();
        if (this.embeddings) {
            try {
                const insights = this.getAllInsights();
                this.logger?.debug(`initialize: building embedding index for ${insights.length} insights`);
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
        this.logger?.debug(`extractFromConversation: userMessage length=${userMessage.length}, assistantMessages=${assistantMessages?.length ?? 0}`);
        try {
            const insights = this.getAllInsights();
            const existingNames = insights.map(s => s.name);
            this.logger?.debug(`extractFromConversation: existing insights=[${existingNames.join(', ')}]`);
            const extracted = await this.extractor.extract(userMessage, assistantMessages ?? [], existingNames);
            this.logger?.debug(`extractFromConversation: extractor returned ${extracted.length} items`);

            for (const item of extracted) {
                if (item.action === 'delete') {
                    const existing = insights.find(s => s.name === item.name);
                    if (existing) {
                        this.archiveInsight(existing, this.usageTracker.getUsage(existing.path));
                        this.logger?.info(`Insight auto-deleted: ${existing.name}`);
                    }
                    continue;
                }

                if (item.action === 'patch' && item.patchTarget) {
                    const existing = insights.find(s => s.name === item.patchTarget);
                    if (existing) {
                        const rebuilt = this.rebuildSkillMd(existing, item.content, item.description);
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
                const skillMd = `---
name: ${item.name}
type: insight
description: ${item.description}
---

${item.content}`;
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

    async getRelevantInsights(query: string, limit?: number): Promise<string | null> {
        const max = limit ?? this.insightLimit!;
        const insights = this.getAllInsights();
        this.logger?.debug(`getRelevantInsights: query="${query.slice(0, 80)}", total=${insights.length}, max=${max}`);
        if (insights.length === 0) return null;

        let selected: Skill[];
        if (insights.length <= max) {
            selected = insights;
        } else {
            selected = await this.searcher.search(query, insights, toSearchable, max, this.embeddings);
        }
        this.logger?.debug(`getRelevantInsights: selected ${selected.length} insights: [${selected.map(s => s.name).join(', ')}]`);

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
        this.logger?.debug(`curate: checking ${insights.length} insights for staleness/archival`);
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

    // ── Helpers ──

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
}
