import { database, HeartbeatRow } from "../Core/Database";
import { loadPrompt } from "../Core/PromptLoader";
import { LoggerService } from "../Core/LoggerService";
import { triggerSession } from "../Core/triggerSession";
import { decideSmart } from "./decideSmart";
import { checkThrottle, recordSentPatch } from "./throttle";

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
    const { heartbeatId, config: row } = ctx;
    const tag = `[heartbeat:${heartbeatId}]`;

    if (!row.enabled) return;

    if (!isInActiveHours(row)) {
        logger.debug(`${tag} skipped: outside active hours`);
        return;
    }

    if (row.mode === 'smart') {
        await executeSmart(tag, row);
    } else {
        await executeFixed(tag, row);
    }

    await database.update(database.heartbeat, { lastRun: Date.now() }, { where: { id: heartbeatId } });
}

async function executeFixed(tag: string, row: HeartbeatRow): Promise<void> {
    const prompt = loadPrompt(row.promptFile);
    await triggerSession({
        targetId: row.target,
        message: prompt,
        aiProcess: true,
        awaitCompletion: true,
        tag,
    });
}

async function executeSmart(tag: string, row: HeartbeatRow): Promise<void> {
    const now = Date.now();
    const verdict = checkThrottle(row, now);
    if (!verdict.pass) {
        logger.debug(`${tag} smart throttled: ${verdict.reason}`);
        return;
    }

    const decision = await decideSmart(row);
    logger.info(`${tag} smart decision: shouldSend=${decision.shouldSend} reason="${decision.reason}"`);
    if (!decision.shouldSend || !decision.message) return;

    const result = await triggerSession({
        targetId: row.target,
        message: decision.message,
        aiProcess: false,
        tag,
    });
    if (!result.ok) {
        logger.warn(`${tag} smart send failed; not counting toward throttle`);
        return;
    }

    const patch = recordSentPatch(row, now);
    await database.update(database.heartbeat, patch, { where: { id: row.id } });
}
