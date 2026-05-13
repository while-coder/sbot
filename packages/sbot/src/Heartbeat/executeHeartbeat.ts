import { database, HeartbeatRow, ChannelSessionRow, channelThreadId } from "../Core/Database";
import { config } from "../Core/Config";
import { loadPrompt } from "../Core/PromptLoader";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../Session/SessionManager";


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

    const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, hbConfig.target);
    if (!dbSession) {
        logger.error(`${tag} channel_session id=${hbConfig.target} not found`);
        return;
    }
    const channel = config.getChannel(dbSession.channelId);
    if (!channel) {
        logger.error(`${tag} channel config not found: ${dbSession.channelId}`);
        return;
    }

    const toolWhitelist = channel.heartbeatTools ?? [];
    const threadId = channelThreadId(channel.type, dbSession.channelId, dbSession.sessionId);

    await new Promise<void>((resolve, reject) => {
        sessionManager.onReceiveChannelMessage(threadId, prompt, {
            channelType: channel.type,
            channelId: dbSession.channelId,
            dbSessionId: hbConfig.target,
            sessionId: dbSession.sessionId,
            silent: true,
            toolWhitelist,
            onComplete: (error?: any) => {
                if (error) reject(error);
                else resolve();
            },
        });
    });

    await database.update(database.heartbeat, { lastRun: Date.now() }, { where: { id: heartbeatId } });
}
