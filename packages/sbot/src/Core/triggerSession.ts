import type { ChannelConfig } from "sbot.commons";
import { config } from "./Config";
import { LoggerService } from "./LoggerService";
import { channelDataService } from "../Session/ChannelDataService";
import { channelManager } from "../Channel/ChannelManager";
import { sessionManager } from "../Session/SessionManager";

const logger = LoggerService.getLogger("triggerSession.ts");

export interface TriggerSessionOptions {
    targetId: number | string | null;
    message: string;
    aiProcess: boolean;
    toolWhitelist?: string[] | ((channel: ChannelConfig) => string[] | undefined);
    awaitCompletion?: boolean;
    tag: string;
}

export interface TriggerSessionResult {
    ok: boolean;
    channelType?: string;
    sessionId?: string;
}

export async function triggerSession(opts: TriggerSessionOptions): Promise<TriggerSessionResult> {
    const { targetId, message, aiProcess, toolWhitelist, awaitCompletion, tag } = opts;

    if (targetId == null) {
        logger.warn(`${tag} target session id missing`);
        return { ok: false };
    }
    const eff = await channelDataService.getEffective(targetId);
    if (!eff) {
        logger.warn(`${tag} target session not found (id=${targetId})`);
        return { ok: false };
    }
    const { session: sessionRow } = eff;
    const { channelId, sessionId, id: dbSessionId } = sessionRow;

    const channelConfig = config.getChannel(channelId);
    const channelType = channelConfig?.type;
    if (!channelType) {
        logger.warn(`${tag} unknown channel type for channelId=${channelId}`);
        return { ok: false };
    }

    if (!aiProcess) {
        await channelManager.sendText(channelId, sessionId, message);
        return { ok: true, channelType, sessionId };
    }

    const resolvedWhitelist = typeof toolWhitelist === "function" ? toolWhitelist(channelConfig) : toolWhitelist;
    const args = { channelType, channelId, dbSessionId, sessionId, headless: true, toolWhitelist: resolvedWhitelist };
    if (awaitCompletion) {
        await new Promise<void>((resolve, reject) => {
            sessionManager.onReceiveChannelMessage(message, {
                ...args,
                onComplete: (err?: any) => err ? reject(err) : resolve(),
            });
        });
    } else {
        await sessionManager.onReceiveChannelMessage(message, args);
    }
    return { ok: true, channelType, sessionId };
}
