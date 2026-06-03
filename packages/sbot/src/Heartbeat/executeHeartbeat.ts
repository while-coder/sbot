import { database, HeartbeatRow } from "../Core/Database";
import { loadPrompt } from "../Core/PromptLoader";
import { LoggerService } from "../Core/LoggerService";
import { triggerSession } from "../Core/triggerSession";

const logger = LoggerService.getLogger("executeHeartbeat.ts");

export interface HeartbeatExecutionContext {
    heartbeatId: number;
    config: HeartbeatRow;
}

function isInActiveHours(row: HeartbeatRow): boolean {
    if (row.activeHoursStart == null || row.activeHoursEnd == null) return true;
    const now = new Date();
    const hour = row.activeHoursTimezone
        ? parseInt(now.toLocaleString('en-US', { timeZone: row.activeHoursTimezone, hour: 'numeric', hour12: false }), 10)
        : now.getHours();

    if (row.activeHoursStart <= row.activeHoursEnd) {
        return hour >= row.activeHoursStart && hour < row.activeHoursEnd;
    }
    return hour >= row.activeHoursStart || hour < row.activeHoursEnd;
}

export async function executeHeartbeat(ctx: HeartbeatExecutionContext): Promise<void> {
    const { heartbeatId, config: hbConfig } = ctx;
    const tag = `[heartbeat:${heartbeatId}]`;

    if (!hbConfig.enabled) return;

    if (!isInActiveHours(hbConfig)) {
        logger.debug(`${tag} skipped: outside active hours`);
        return;
    }

    const prompt = loadPrompt(hbConfig.promptFile);

    const result = await triggerSession({
        targetId: hbConfig.target,
        message: prompt,
        aiProcess: true,
        toolWhitelist: ch => ch.heartbeatTools,
        awaitCompletion: true,
        tag,
    });
    if (!result.ok) return;

    await database.update(database.heartbeat, { lastRun: Date.now() }, { where: { id: heartbeatId } });
}
