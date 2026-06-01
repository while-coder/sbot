import type { ChannelConfig } from "sbot.commons";
import { WEB_CHANNEL_ID } from "sbot.commons";
import { config } from "./Config";
import { LoggerService } from "./LoggerService";
import { getEffectiveSession } from "./Database";
import { channelManager } from "../Channel/ChannelManager";
import { sessionManager } from "../Session/SessionManager";

const logger = LoggerService.getLogger("dispatchToSession.ts");

export interface DispatchToSessionOptions {
    targetId: number | string | null;
    message: string;
    aiProcess: boolean;
    silent?: boolean;
    toolWhitelist?: string[] | ((channel: ChannelConfig) => string[] | undefined);
    awaitCompletion?: boolean;
    tag: string;
}

export interface DispatchResult {
    ok: boolean;
    channelType?: string;
    sessionId?: string;
}

export async function dispatchToSession(opts: DispatchToSessionOptions): Promise<DispatchResult> {
    const { targetId, message, aiProcess, silent, toolWhitelist, awaitCompletion, tag } = opts;

    if (targetId == null) {
        logger.warn(`${tag} target session id missing`);
        return { ok: false };
    }
    const eff = await getEffectiveSession(targetId);
    if (!eff) {
        logger.warn(`${tag} target session not found (id=${targetId})`);
        return { ok: false };
    }
    const { session: sessionRow, resolved } = eff;
    const { channelId, sessionId, id: dbSessionId } = sessionRow;

    const channelConfig = config.getChannel(channelId);
    const channelType = channelConfig?.type;
    if (!channelType) {
        logger.warn(`${tag} unknown channel type for channelId=${channelId}`);
        return { ok: false };
    }

    if (!aiProcess) {
        if (channelId === WEB_CHANNEL_ID) {
            logger.warn(`${tag} raw mode is not supported for web channel`);
            return { ok: false, channelType, sessionId };
        }
        await channelManager.sendText(channelId, sessionId, message);
        return { ok: true, channelType, sessionId };
    }

    const threadId = resolved.threadKey;  // = String(profile.id)
    const resolvedWhitelist = typeof toolWhitelist === "function" ? toolWhitelist(channelConfig) : toolWhitelist;
    const args = { channelType, channelId, dbSessionId, sessionId, silent, toolWhitelist: resolvedWhitelist };
    if (awaitCompletion) {
        await new Promise<void>((resolve, reject) => {
            sessionManager.onReceiveChannelMessage(threadId, message, {
                ...args,
                onComplete: (err?: any) => err ? reject(err) : resolve(),
            });
        });
    } else {
        await sessionManager.onReceiveChannelMessage(threadId, message, args);
    }
    return { ok: true, channelType, sessionId };
}
