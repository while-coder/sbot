import { TimeUtils } from "scorpio.ai";
import { database, HeartbeatMode, type FixedHeartbeatRow, type HeartbeatRow } from "../Core/Database";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";
import { triggerSession } from "../Core/triggerSession";
import { buildHeartbeatPromptVars } from "./heartbeatContext";
import { HeartbeatBase, type HeartbeatScheduleContext } from "./HeartbeatBase";

const logger = LoggerService.getLogger("FixedHeartbeat.ts");

export class FixedHeartbeat extends HeartbeatBase<FixedHeartbeatRow> {
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
        logger.info(`Heartbeat [${this.id}] scheduled (fixed next in ~${Math.round(delayMs / TimeUtils.MINUTE_MS)}m, factor=${factor.toFixed(2)})`);
    }

    protected async run(tag: string, row: FixedHeartbeatRow): Promise<boolean> {
        const prompt = loadPrompt(row.promptFile, await buildHeartbeatPromptVars(row));
        const result = await triggerSession({
            targetId: row.sessionId,
            message: prompt,
            aiProcess: true,
            awaitCompletion: true,
            tag,
        });
        return result.ok;
    }

    private async scheduleNextIfStillActive(ctx: HeartbeatScheduleContext): Promise<void> {
        if (!ctx.hasTimer(this.id)) return;
        const fresh = await database.findByPk<HeartbeatRow>(database.heartbeat, this.id);
        if (fresh?.enabled && fresh.mode === HeartbeatMode.Fixed) {
            new FixedHeartbeat(fresh).schedule(ctx);
        }
    }
}
