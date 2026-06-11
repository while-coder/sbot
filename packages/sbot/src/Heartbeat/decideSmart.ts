import { z } from "zod";
import { MessageRole, AgendaStatus, TimeUtils } from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";
import { agendaStorePool } from "../Agenda/AgendaStorePool";
import { HeartbeatRow } from "../Core/Database";

const logger = LoggerService.getLogger("decideSmart.ts");

const DEFAULT_PROMPT = "heartbeat/smart-default.md";

const SmartDecisionSchema = z.object({
    shouldSend: z.boolean().describe("Whether to actually send a message to the user now"),
    reason: z.string().describe("Brief justification, used for logs"),
    message: z.string().optional().describe("The message content to send to the user, in 1-2 sentences. Required iff shouldSend=true."),
});

export type SmartDecision = z.infer<typeof SmartDecisionSchema>;

/**
 * smart 心跳的"要不要发 / 发什么"判断。
 * 失败时 shouldSend=false，调用方按"本次跳过"处理。
 */
export async function decideSmart(row: HeartbeatRow): Promise<SmartDecision> {
    const tag = `[heartbeat:${row.id}:decide]`;

    if (!row.decisionModelId) {
        logger.warn(`${tag} no decisionModelId configured, skipping`);
        return { shouldSend: false, reason: "decisionModelId not configured" };
    }

    const modelService = await config.getModelService(row.decisionModelId);
    if (!modelService) {
        logger.warn(`${tag} model service "${row.decisionModelId}" not found`);
        return { shouldSend: false, reason: `model service ${row.decisionModelId} not found` };
    }

    try {
        const vars: Record<string, string> = {
            now: formatNow(row.activeHoursTimezone),
            lastSentAgo: row.lastSentAt ? formatAgo(Date.now() - row.lastSentAt) : "从未",
            agendaList: await buildAgendaContext(row.agendaId),
        };
        const prompt = loadPrompt(row.decisionPromptFile ?? DEFAULT_PROMPT, vars);

        const result = await modelService.invokeStructured<SmartDecision>(
            SmartDecisionSchema,
            [{ role: MessageRole.System, content: prompt }],
            { signal: AbortSignal.timeout(60_000) },
        );

        if (result.shouldSend && !result.message?.trim()) {
            logger.warn(`${tag} model returned shouldSend=true but empty message, treating as skip`);
            return { shouldSend: false, reason: "empty message returned" };
        }
        return result;
    } catch (err: any) {
        logger.error(`${tag} decision call failed: ${err?.message ?? String(err)}`);
        return { shouldSend: false, reason: `decision error: ${err?.message ?? String(err)}` };
    } finally {
        await modelService.dispose();
    }
}

function formatNow(timezone: string | null): string {
    return new Date().toLocaleString('zh-CN', timezone ? { timeZone: timezone } : undefined);
}

function formatAgo(ms: number): string {
    if (ms < 60_000) return "刚刚";
    const min = Math.round(ms / 60_000);
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.round(hr / 24);
    return `${day} 天前`;
}

async function buildAgendaContext(agendaId: string | null): Promise<string> {
    if (!agendaId) return "（未配置 agenda 上下文）";
    try {
        const records = await agendaStorePool.get(agendaId).listItems();
        const pending = records.filter(r => r.item.status === AgendaStatus.Pending);
        if (pending.length === 0) return "（当前没有待办）";

        const lines = pending.slice(0, 30).map(r => {
            const item = r.item;
            const due = item.dueAt ? ` due=${TimeUtils.formatWhen(item.dueAt)}` : "";
            const next = firstEnabledNextFire(r.triggers);
            const nextText = next ? ` next=${TimeUtils.formatWhen(next)}` : "";
            return `#${item.id} [${item.priority}/${item.category}] ${item.content}${due}${nextText}`;
        });
        return `${pending.length} 项待办：\n${lines.join("\n")}`;
    } catch (err: any) {
        logger.warn(`load agenda context [${agendaId}] failed: ${err?.message ?? String(err)}`);
        return "（agenda 上下文加载失败）";
    }
}

function firstEnabledNextFire(triggers: { enabled: boolean; nextFireAt: number | null }[] | undefined): number | null {
    if (!triggers) return null;
    let earliest: number | null = null;
    for (const t of triggers) {
        if (!t.enabled || t.nextFireAt == null) continue;
        if (earliest == null || t.nextFireAt < earliest) earliest = t.nextFireAt;
    }
    return earliest;
}
