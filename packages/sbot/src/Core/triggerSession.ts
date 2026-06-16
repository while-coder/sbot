import {
    MessageKind,
    MessageRole,
    SessionDeliveryMode,
} from "scorpio.ai";
import { WEB_CHANNEL_TYPE } from "sbot.commons";
import { config } from "./Config";
import { LoggerService } from "./LoggerService";
import { channelDataService } from "../Session/ChannelDataService";
import { channelManager } from "../Channel/ChannelManager";
import { sessionManager } from "../Session/SessionManager";
import { SaverPool } from "../Agent/SaverPool";
import { webService } from "../Channel/web/WebService";

const logger = LoggerService.getLogger("triggerSession.ts");

export interface TriggerSessionOptions {
    targetId: number | string | null;
    message: string;
    mode: SessionDeliveryMode;
    awaitCompletion?: boolean;
    tag: string;
}

export interface TriggerSessionResult {
    ok: boolean;
    channelType?: string;
    sessionId?: string;
}

export async function triggerSession(opts: TriggerSessionOptions): Promise<TriggerSessionResult> {
    const { targetId, message, mode, awaitCompletion, tag } = opts;

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

    if (mode === SessionDeliveryMode.Invoke) {
        const args = { channelType, channelId, dbSessionId, sessionId, headless: true, toolWhitelist: channelConfig.triggerTools };
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

    // web channel + NotifyAndRecord：sendTextToSession 会以 Command kind 写一条 saver
    // 并广播；下面的 saver 写入又会作为 Normal kind 写第二条，前端会显示两条重复消息。
    // 跳过文本投递、改为下方手动以 Normal kind 广播一次，让前端只展示一条。
    const isWebNotifyAndRecord = channelType === WEB_CHANNEL_TYPE && mode === SessionDeliveryMode.NotifyAndRecord;

    if (!isWebNotifyAndRecord) {
        const r = await channelManager.sendTextToSession(dbSessionId, message);
        if (!r.ok) return { ok: false };
    }

    // NotifyAndRecord 额外把这条投递写入 saver，作为 AI 角色的 Normal 消息，
    // 这样后续主对话 agent 能在上下文中看到"刚才系统已经提醒过用户"，
    // 避免用户突然回复"已喝 / 已交"时 AI 上下文断裂。
    if (mode === SessionDeliveryMode.NotifyAndRecord) {
        const chatMessage = { role: MessageRole.AI, content: message };
        try {
            const handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
            try {
                await handle.saver.pushMessage(chatMessage, { kind: MessageKind.Normal });
            } finally {
                await handle.release();
            }
        } catch (e: any) {
            // saver 写入失败不影响投递成功——只是丢了上下文记录。记录 warn。
            logger.warn(`${tag} saver record failed: ${e?.message ?? String(e)}`);
        }

        if (isWebNotifyAndRecord) {
            webService.broadcastMessage(sessionRow.profileId, chatMessage, MessageKind.Normal);
        }
    }
    return { ok: true, channelType, sessionId };
}
