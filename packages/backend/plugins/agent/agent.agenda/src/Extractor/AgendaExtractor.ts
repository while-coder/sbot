import { z } from "zod";
import { inject } from "scorpio.di";
import {
    IModelService,
    ILoggerService,
    type ILogger,
    MessageRole,
    contentToString,
    estimateMessagesTokens,
    truncateForLog,
    type ChatMessage,
    renderConversation,
    TimeUtils,
    formatError,
} from "scorpio.ai";
import {
    AgendaPriority,
    AgendaTriggerAction,
    type AgendaRecord,
} from "../types";
import {
    AgendaRenderMode,
    formatAgendaRecordsXml,
} from "../format";
import { T_AgendaExtractorSystemPrompt, T_AgendaName, T_AgendaSelectorSystemPrompt } from "../tokens";
import { createAgendaTriggerSchemas } from "../triggerSchemas";
import { type AgendaAction, AgendaActionType, IAgendaExtractor } from "./IAgendaExtractor";
import { AgendaOverflowSelector } from "./AgendaOverflowSelector";

const ActionSchema = z.enum(AgendaTriggerAction).optional().describe('Per-trigger delivery mode. notify (default), notify_and_record (also records the fire into the conversation history), invoke.');
const MessageSchema = z.string().min(1).describe('REQUIRED per-trigger fire-time text — the exact words delivered WHEN this trigger fires, phrased as a present-moment ping ("Time to drink water"), NOT as a request to set a reminder ("remind me to drink water in 2 min" ✗). No fallback to content; if there is no special wording, restate the content. Recorded fires re-enter the conversation, so request-like wording can make this very sync create a duplicate agenda.');
const { TriggerSpecSchema, TriggerEditSchema } = createAgendaTriggerSchemas({
    action: ActionSchema,
    message: MessageSchema,
    patchMessage: z.string().min(1).optional(),
});

const CreateArgsSchema = z.object({
    content: z.string().describe('Canonical, self-contained title. A clean noun-phrase or imperative ("Submit weekly report", "Drink water", "Build a web matching game (timer / levels / shuffle / hints)"); not a reply or a kickoff phrase like "Start by ...". Do NOT bake relative time or schedule into the title ("remind me to drink water in 2 min" ✗ → "Drink water"); timing belongs in triggers. Match the user\'s language. Note: each trigger carries its own required message — content is not the fire-time fallback.'),
    priority: z.enum(AgendaPriority).optional(),
    triggers: z.array(TriggerSpecSchema).optional().describe('Schedule list; each element carries its own action/message. Omit or [] for a plain todo with no time.'),
    dueAt: z.string().optional(),
});

const SetPatchSchema = z.object({
    content: z.string().optional(),
    priority: z.enum(AgendaPriority).optional(),
    dueAt: z.string().nullable().optional(),
}).describe('Item-level field changes. Omit when only the schedule changes.');

const AgendaExtractSchema = z.object({
    actions: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal(AgendaActionType.Create), args: CreateArgsSchema }),
        z.object({
            type: z.literal(AgendaActionType.Edit),
            id: z.number().describe('agenda id from <existing-agenda>.'),
            set: SetPatchSchema.optional(),
            triggers: z.array(TriggerEditSchema).optional().describe('Trigger operations, applied in order. Put every related change into ONE edit action so content and schedule land together.'),
        }),
    ])).describe("Agenda actions extracted from the conversation. Return [] if no agenda change is needed."),
});

export class AgendaExtractor implements IAgendaExtractor {
    private logger?: ILogger;
    private readonly overflowSelector: AgendaOverflowSelector;
    private agendaName = '未知配置';

    constructor(
        @inject(IModelService) private modelService: IModelService,
        @inject(T_AgendaExtractorSystemPrompt) private systemPrompt: string,
        @inject(T_AgendaSelectorSystemPrompt) selectorPrompt: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(T_AgendaName, { optional: true }) agendaName?: string,
    ) {
        this.agendaName = agendaName?.trim() || '未知配置';
        this.logger = loggerService?.getLogger("AgendaExtractor");
        this.overflowSelector = new AgendaOverflowSelector(modelService, selectorPrompt, this.prefixedLogger());
    }

    modelLabel(): string {
        return AgendaExtractor.formatModelLabel(this.modelService);
    }

    private static formatModelLabel(model: IModelService): string {
        const cfg = model.config as any;
        const name = cfg.name || cfg.model || '?';
        const detail = [
            cfg.provider,
            cfg.model && cfg.model !== name ? cfg.model : '',
        ].filter(Boolean).join('/');
        return detail ? `${name}(${detail})` : name;
    }

    private logAgenda(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
        const line = `[日程:${this.agendaName}] ${message}`;
        switch (level) {
            case 'debug':
                this.logger?.debug(line);
                break;
            case 'info':
                this.logger?.info(line);
                break;
            case 'warn':
                this.logger?.warn(line);
                break;
            case 'error':
                this.logger?.error(line);
                break;
        }
    }

    /** 给子组件（OverflowSelector）用的日志实例：统一加 [日程:名] 前缀。 */
    private prefixedLogger(): ILogger | undefined {
        const logger = this.logger;
        if (!logger) return undefined;
        const prefix = `[日程:${this.agendaName}] `;
        return {
            debug: (message: string, ...args: any[]) => logger.debug(prefix + message, ...args),
            info: (message: string, ...args: any[]) => logger.info(prefix + message, ...args),
            warn: (message: string, ...args: any[]) => logger.warn(prefix + message, ...args),
            error: (message: string, ...args: any[]) => logger.error(prefix + message, ...args),
        };
    }

    /** 抽取输入的 query 预览：取最后一条用户消息（与 AgendaService.messagePreview 一致）。 */
    private static messagePreview(messages: ChatMessage[]): string {
        const message = [...messages].reverse().find(m => m.role === MessageRole.Human) ?? messages[messages.length - 1];
        if (!message) return '空消息';
        const text = contentToString(message.content).replace(/\s+/g, ' ').trim();
        if (!text) return '空消息';
        return truncateForLog(text);
    }

    async extract(messages: ChatMessage[], existingItems: AgendaRecord[]): Promise<AgendaAction[]> {
        try {
            const conversation = renderConversation(messages);
            const now = TimeUtils.formatIsoMinute(Date.now());
            const inputBudget = this.overflowSelector.inputTokenBudget();
            const directMessages = this.buildExtractionMessages(
                conversation,
                existingItems,
                AgendaRenderMode.Sync,
                now,
            );
            const directTokens = estimateMessagesTokens(directMessages);

            // 常规路径保持一次模型调用：完整对话 + 全部 Pending Agenda 完整结构。
            if (directTokens <= inputBudget) {
                this.logAgenda('debug', `日程抽取单次直通：条目=${existingItems.length}，估算输入=${directTokens} tokens，预算=${inputBudget}`);
                return this.invokeActions(directMessages, existingItems);
            }

            // 超预算规划只负责挑出有序候选；最终动作仍由本类统一生成和校验。
            this.logAgenda('debug', `日程抽取输入超预算，切换候选分批：条目=${existingItems.length}，估算输入=${directTokens} tokens，预算=${inputBudget}`);
            let selected = await this.overflowSelector.select(conversation, existingItems, now, inputBudget);

            let renderMode = AgendaRenderMode.Sync;
            const provisional = this.buildExtractionMessages(
                conversation,
                selected,
                renderMode,
                now,
                true,
            );
            if (estimateMessagesTokens(provisional) > inputBudget) {
                // 极长 invoke message 可能让少量候选仍超预算。Compact 仍保留 item/trigger id、
                // schedule、action 与 message preview，Edit 的未提供字段由 service 原样保留。
                this.logAgenda('warn', `日程抽取候选全量仍超预算，改用消息预览：候选=${selected.length} 条`);
                renderMode = AgendaRenderMode.Compact;
            }

            // 极小上下文模型下，20 条 Compact 卡片本身也可能装不下。候选已经按全局
            // relevance 排序，因此从尾部移除最低相关项，先为 system prompt 留出确定空间。
            const selectedBeforeBudgetFit = selected.length;
            while (
                selected.length > 0
                && estimateMessagesTokens(this.buildExtractionMessages('', selected, renderMode, now, true)) > inputBudget
            ) {
                selected = selected.slice(0, -1);
            }
            if (selected.length < selectedBeforeBudgetFit) {
                this.logAgenda('warn', `日程抽取候选集为适配输入预算缩减：${selectedBeforeBudgetFit} → ${selected.length} 条`);
            }

            // Compact 只缩 agenda 卡片；这里再对 conversation 做最后兜底，保证最终请求本身也在预算内。
            const finalConversation = this.overflowSelector.fitConversationToBudget(
                conversation,
                value => this.buildExtractionMessages(value, selected, renderMode, now, true),
                inputBudget,
                'final writer',
            );
            const finalMessages = this.buildExtractionMessages(finalConversation, selected, renderMode, now, true);
            return this.invokeActions(finalMessages, selected);
        } catch (error: any) {
            this.logAgenda('warn', `日程抽取失败：query=${AgendaExtractor.messagePreview(messages)}，模型=${this.modelLabel()}，错误=${formatError(error, true)}`);
            // 让 AgendaService 把 pending job 标为 failed，而不是把模型/Schema/上下文错误
            // 伪装成“成功但没有 action”后永久删除原始对话快照。
            throw error;
        }
    }

    private async invokeActions(messages: ChatMessage[], visibleItems: AgendaRecord[]): Promise<AgendaAction[]> {
        const { actions } = await this.modelService.invokeStructured<{ actions: AgendaAction[] }>(
            AgendaExtractSchema,
            messages,
        );
        const visibleIds = new Set(visibleItems.map(record => record.item.id));
        return actions.filter(action => {
            if (action.type === AgendaActionType.Create || visibleIds.has(action.id)) return true;
            this.logAgenda('warn', `日程抽取忽略未展示给最终模型的 Edit 动作：#${action.id}`);
            return false;
        });
    }

    private buildExtractionMessages(
        conversation: string,
        existingItems: AgendaRecord[],
        mode: AgendaRenderMode.Sync | AgendaRenderMode.Compact,
        now: string,
        candidateSubset = false,
    ): ChatMessage[] {
        let human = conversation;
        if (existingItems.length > 0) {
            human += `\n<existing-agenda>\n${formatAgendaRecordsXml(existingItems, mode)}\n</existing-agenda>`;
        }
        human += `\n<now>${now}</now>`;
        return [
            {
                role: MessageRole.System,
                content: candidateSubset
                    ? [
                        this.systemPrompt,
                        `# Oversized-catalog candidate contract`,
                        `A prior pass screened the complete pending agenda catalog. <existing-agenda> contains only likely matches.`,
                        `Edit only IDs shown there. If none matches an explicit new request, Create is allowed.`,
                    ].join('\n\n')
                    : this.systemPrompt,
            },
            { role: MessageRole.Human, content: human },
        ];
    }

}
