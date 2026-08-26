import { z } from "zod";
import {
    formatError,
    type ILogger,
    type IModelService,
    MessageRole,
    estimateMessagesTokens,
    estimateTextTokens,
    type ChatMessage,
} from "scorpio.ai";
import { AgendaRenderMode, formatAgendaRecordsXml, formatAgendaXml } from "../format";
import {
    AGENDA_SYNC_CANDIDATES_PER_BATCH,
    AGENDA_SYNC_FINAL_CANDIDATE_LIMIT,
    AGENDA_SYNC_INTENT_LIMIT,
    AGENDA_SYNC_SELECTOR_BATCH_LIMIT,
    AGENDA_SYNC_INPUT_TOKEN_CAP,
    DEFAULT_AGENDA_CONTEXT_WINDOW,
} from "../limits";
import type { AgendaRecord } from "../types";

const IntentAnalysisSchema = z.object({
    shouldSync: z.boolean(),
    // 上限由代码裁剪，避免模型多返回一条就让结构化输出整体失败。
    intents: z.array(z.string()),
});

const CandidateOutputSchema = z.object({
    // 每批上限由代码裁剪；单个坏批次由本地相关性结果接管。
    candidates: z.array(z.object({
        id: z.number().int().positive(),
        relevance: z.number().finite().optional(),
    })),
});

interface RankedRecord {
    record: AgendaRecord;
    relevance: number;
    sourceIndex: number;
}

/**
 * AgendaSync 超预算规划器。
 *
 * 只负责把完整 Pending 目录压到一组有序候选：
 * 1. 在预算内分析本轮对话；
 * 2. 本地相关性排序完整目录；
 * 3. 最多调用固定数量的 Selector 批次；
 * 4. 用跨批 relevance 全局归并。
 *
 * 它不产生 AgendaAction，也不写 Store；最终决定仍由 AgendaExtractor 完成。
 */
export class AgendaOverflowSelector {
    constructor(
        private readonly modelService: IModelService,
        private readonly systemPrompt: string,
        private readonly logger?: ILogger,
    ) {}

    inputTokenBudget(): number {
        const contextWindow = this.modelService.config.contextWindow ?? DEFAULT_AGENDA_CONTEXT_WINDOW;
        return Math.max(512, Math.min(AGENDA_SYNC_INPUT_TOKEN_CAP, Math.floor(contextWindow * 0.5)));
    }

    async select(
        conversation: string,
        records: AgendaRecord[],
        now: string,
        inputBudget: number,
    ): Promise<AgendaRecord[]> {
        if (records.length === 0) return [];

        const boundedConversation = this.fitConversationToBudget(
            conversation,
            value => this.buildAnalysisMessages(value, now),
            inputBudget,
            'analysis',
        );
        const analysis = await this.modelService.invokeStructured<z.infer<typeof IntentAnalysisSchema>>(
            IntentAnalysisSchema,
            this.buildAnalysisMessages(boundedConversation, now),
        );
        const intents = analysis.intents
            .map(intent => intent.trim().slice(0, 400))
            .filter(Boolean)
            .slice(0, AGENDA_SYNC_INTENT_LIMIT);

        if (!analysis.shouldSync && intents.length === 0) {
            // shouldSync 只用于省掉目录模型调用，不是 Writer 的硬门禁。
            const selected = this.rankRecords([boundedConversation], records)
                .slice(0, AGENDA_SYNC_FINAL_CANDIDATE_LIMIT)
                .map(candidate => candidate.record);
            this.logger?.debug(`日程抽取 Selector 建议无需同步，最终 Writer 仍以 ${selected.length} 条本地候选运行`);
            return selected;
        }

        return this.selectBatches(
            intents.length > 0 ? intents : [boundedConversation],
            records,
            now,
            inputBudget,
        );
    }

    /** 保留 transcript 开头与结尾，使指定请求不超过输入预算。 */
    fitConversationToBudget(
        conversation: string,
        buildMessages: (value: string) => ChatMessage[],
        inputBudget: number,
        stage: string,
    ): string {
        if (estimateMessagesTokens(buildMessages(conversation)) <= inputBudget) return conversation;

        let low = 0;
        let high = conversation.length;
        let best: string | null = null;
        while (low <= high) {
            const length = Math.floor((low + high) / 2);
            const candidate = AgendaOverflowSelector.truncateMiddle(conversation, length);
            if (estimateMessagesTokens(buildMessages(candidate)) <= inputBudget) {
                best = candidate;
                low = length + 1;
            } else {
                high = length - 1;
            }
        }
        if (best == null) {
            throw new Error(`日程抽取 ${stage} 阶段的 prompt 即使不含对话内容也超出输入预算`);
        }
        this.logger?.warn(`日程抽取 ${stage} 阶段对话已截断以适配输入预算：${conversation.length} → ${best.length} 字符`);
        return best;
    }

    private async selectBatches(
        intents: string[],
        records: AgendaRecord[],
        now: string,
        inputBudget: number,
    ): Promise<AgendaRecord[]> {
        const rankedRecords = this.rankRecords(intents, records);
        const chunks = this.chunkCards(
            intents,
            rankedRecords.map(candidate => candidate.record),
            now,
            inputBudget,
        );
        const activeChunks = chunks.slice(0, AGENDA_SYNC_SELECTOR_BATCH_LIMIT);
        const scannedCount = activeChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        this.logger?.debug(`日程抽取候选扫描：条目=${records.length}，批次=${activeChunks.length}/${chunks.length}，每批候选上限=${AGENDA_SYNC_CANDIDATES_PER_BATCH}`);
        if (scannedCount < records.length) {
            this.logger?.warn(`日程抽取 Selector 批次已达上限，${records.length - scannedCount} 条低相关条目未送入模型（按本地排序）`);
        }

        const rankedById = new Map(rankedRecords.map(candidate => [candidate.record.item.id, candidate] as const));
        const selected = new Map<number, RankedRecord>();

        for (const chunk of activeChunks) {
            const available = new Map(chunk.map(record => [record.item.id, record] as const));
            try {
                const output = await this.modelService.invokeStructured<z.infer<typeof CandidateOutputSchema>>(
                    CandidateOutputSchema,
                    this.buildCandidateMessages(intents, chunk, now),
                );
                for (const [rank, candidate] of output.candidates.slice(0, AGENDA_SYNC_CANDIDATES_PER_BATCH).entries()) {
                    const record = available.get(candidate.id);
                    if (!record) {
                        this.logger?.warn(`日程抽取 Selector 返回了当前批次之外的 id：#${candidate.id}`);
                        continue;
                    }
                    const relevance = Math.max(0, Math.min(100, candidate.relevance ?? (100 - rank)));
                    const current = selected.get(candidate.id);
                    if (!current || relevance > current.relevance) {
                        selected.set(candidate.id, {
                            record,
                            relevance,
                            sourceIndex: rankedById.get(candidate.id)?.sourceIndex ?? records.length,
                        });
                    }
                }
            } catch (error: any) {
                this.logger?.warn(`日程抽取 Selector 批次失败，改用本地排序：${formatError(error)}`);
                for (const record of chunk.slice(0, AGENDA_SYNC_CANDIDATES_PER_BATCH)) {
                    if (selected.has(record.item.id)) continue;
                    const ranked = rankedById.get(record.item.id);
                    selected.set(record.item.id, {
                        record,
                        relevance: Math.min(25, ranked?.relevance ?? 0),
                        sourceIndex: ranked?.sourceIndex ?? records.length,
                    });
                }
            }
        }

        return [...selected.values()]
            .sort((a, b) => b.relevance - a.relevance || a.sourceIndex - b.sourceIndex)
            .slice(0, AGENDA_SYNC_FINAL_CANDIDATE_LIMIT)
            .map(candidate => candidate.record);
    }

    private buildAnalysisMessages(conversation: string, now: string): ChatMessage[] {
        return [
            {
                role: MessageRole.System,
                content: [
                    this.systemPrompt,
                    `# Conversation analysis mode`,
                    `Return shouldSync=true for explicit agenda changes that may still need background application. This field is advisory; the final writer always verifies the transcript.`,
                    `When true, return up to ${AGENDA_SYNC_INTENT_LIMIT} short, self-contained intents retaining exact time, recurrence, target wording, and whether it is a create or edit.`,
                ].join('\n\n'),
            },
            { role: MessageRole.Human, content: `${conversation}\n<now>${now}</now>` },
        ];
    }

    private buildCandidateMessages(intents: string[], records: AgendaRecord[], now: string): ChatMessage[] {
        return [
            {
                role: MessageRole.System,
                content: [
                    this.systemPrompt,
                    `# Agenda-card matching mode`,
                    `Match the confirmed intents against this exact batch of compact agenda cards.`,
                    `Return up to ${AGENDA_SYNC_CANDIDATES_PER_BATCH} candidates as {id, relevance}, ordered from most to least relevant. relevance is an integer from 0 to 100 and must be comparable across batches.`,
                    `Do not propose Create/Edit actions and do not return IDs outside this batch.`,
                ].join('\n\n'),
            },
            {
                role: MessageRole.Human,
                content: [
                    `<agenda-intents>`,
                    intents.map(intent => `- ${intent}`).join('\n'),
                    `</agenda-intents>`,
                    `<agenda-cards>`,
                    formatAgendaRecordsXml(records, AgendaRenderMode.Compact),
                    `</agenda-cards>`,
                    `<now>${now}</now>`,
                ].join('\n'),
            },
        ];
    }

    private chunkCards(
        intents: string[],
        records: AgendaRecord[],
        now: string,
        inputBudget: number,
    ): AgendaRecord[][] {
        const emptyMessages = this.buildCandidateMessages(intents, [], now);
        const cardBudget = Math.max(256, inputBudget - estimateMessagesTokens(emptyMessages));
        const chunks: AgendaRecord[][] = [];
        let current: AgendaRecord[] = [];
        let currentTokens = 0;
        for (const record of records) {
            const recordTokens = estimateTextTokens(formatAgendaXml(record, AgendaRenderMode.Compact));
            if (current.length > 0 && currentTokens + recordTokens > cardBudget) {
                chunks.push(current);
                current = [];
                currentTokens = 0;
            }
            current.push(record);
            currentTokens += recordTokens;
        }
        if (current.length > 0) chunks.push(current);
        return chunks;
    }

    private rankRecords(intents: string[], records: AgendaRecord[]): RankedRecord[] {
        const normalizedIntents = intents.map(AgendaOverflowSelector.normalize).filter(Boolean);
        const intentFeatures = new Set(normalizedIntents.flatMap(AgendaOverflowSelector.features));
        return records
            .map((record, sourceIndex) => {
                const content = AgendaOverflowSelector.normalize(record.item.content);
                const compact = AgendaOverflowSelector.normalize(formatAgendaXml(record, AgendaRenderMode.Compact));
                let relevance = 0;
                for (const intent of normalizedIntents) {
                    if (intent.includes(`#${record.item.id}`) || intent.includes(`agenda${record.item.id}`)) relevance += 100;
                    if (content && (intent.includes(content) || content.includes(intent))) relevance += 80;
                }
                const overlap = AgendaOverflowSelector.features(compact)
                    .filter(feature => intentFeatures.has(feature)).length;
                if (intentFeatures.size > 0) relevance += Math.min(60, overlap * 60 / intentFeatures.size);
                return { record, relevance, sourceIndex };
            })
            .sort((a, b) => b.relevance - a.relevance || a.sourceIndex - b.sourceIndex);
    }

    private static normalize(value: string): string {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    private static features(value: string): string[] {
        const features = new Set(value.match(/[a-z0-9_#:-]{2,}/g) ?? []);
        const cjk = value.replace(/[^\u3400-\u9fff]/g, '');
        for (let i = 0; i + 1 < cjk.length; i++) features.add(cjk.slice(i, i + 2));
        return [...features];
    }

    private static truncateMiddle(value: string, maxChars: number): string {
        if (value.length <= maxChars) return value;
        if (maxChars <= 0) return '';
        const marker = `\n...[${value.length - maxChars} chars omitted]...\n`;
        if (maxChars <= marker.length) return value.slice(0, maxChars);
        const available = maxChars - marker.length;
        const head = Math.ceil(available * 0.6);
        return value.slice(0, head) + marker + value.slice(value.length - (available - head));
    }
}
