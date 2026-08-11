import { z } from "zod";
import { MessageRole, SessionDeliveryMode, TimeUtils } from "scorpio.ai";
import { database, HeartbeatMode, type HeartbeatRow, type SmartHeartbeatRow } from "../Core/Database";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";
import { triggerSession } from "../Core/triggerSession";
import { buildHeartbeatPromptVars } from "./heartbeatContext";
import { HeartbeatBase, type HeartbeatScheduleContext } from "./HeartbeatBase";

const logger = LoggerService.getLogger("SmartHeartbeat.ts");
const DEFAULT_PROMPT = "heartbeat/smart-default.md";

const SmartDecisionSchema = z.object({
    shouldSend: z.boolean().describe("Whether to actually send a message to the user now"),
    reason: z.string().describe("Brief justification, used for logs"),
    message: z.string().optional().describe("The message content to send to the user, in 1-2 sentences. Required iff shouldSend=true."),
});

type SmartDecision = z.infer<typeof SmartDecisionSchema>;

export class SmartHeartbeat extends HeartbeatBase<SmartHeartbeatRow> {
    protected scheduleNext(ctx: HeartbeatScheduleContext): void {
        const { delayMs, factor } = TimeUtils.computeJitterDelay(this.intervalMs(), this.row.jitterMinPct, this.row.jitterMaxPct);
        const handle = setTimeout(async () => {
            try {
                await ctx.execute(this.id);
            } finally {
                await this.scheduleNextIfStillActive(ctx);
            }
        }, delayMs);

        ctx.setTimer(this.id, handle);
        logger.info(`Heartbeat [${this.id}] smart next in ~${Math.round(delayMs / TimeUtils.MINUTE_MS)}m (factor=${factor.toFixed(2)})`);
    }

    protected async run(tag: string, row: SmartHeartbeatRow): Promise<boolean> {
        const decision = await this.decide(row);
        logger.info(`${tag} smart decision: shouldSend=${decision.shouldSend} reason="${decision.reason}"`);
        if (!decision.shouldSend || !decision.message) return false;

        const result = await triggerSession({
            targetId: row.sessionId,
            message: decision.message,
            mode: SessionDeliveryMode.Notify,
            tag,
        });
        if (!result.ok) {
            logger.warn(`${tag} smart send failed; not counting toward throttle`);
            return false;
        }
        return true;
    }

    private async decide(row: SmartHeartbeatRow): Promise<SmartDecision> {
        const tag = `[heartbeat:${row.id}:decide]`;

        if (!row.decisionModelId) {
            logger.warn(`${tag} no decisionModelId configured, skipping`);
            return { shouldSend: false, reason: "decisionModelId not configured" };
        }

        const modelService = config.getModelService(row.decisionModelId);
        if (!modelService) {
            logger.warn(`${tag} model service "${row.decisionModelId}" not found`);
            return { shouldSend: false, reason: `model service ${row.decisionModelId} not found` };
        }

        try {
            const vars = await buildHeartbeatPromptVars(row);
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

    private async scheduleNextIfStillActive(ctx: HeartbeatScheduleContext): Promise<void> {
        if (!ctx.hasTimer(this.id)) return;
        const fresh = await database.findByPk<HeartbeatRow>(database.heartbeat, this.id);
        if (fresh?.enabled && fresh.mode === HeartbeatMode.Smart) {
            new SmartHeartbeat(fresh).schedule(ctx);
        }
    }
}
