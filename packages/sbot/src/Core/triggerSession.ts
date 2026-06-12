import {
    AgendaTriggerAction,
    MessageKind,
    MessageRole,
} from "scorpio.ai";
import { config } from "./Config";
import { LoggerService } from "./LoggerService";
import { channelDataService } from "../Session/ChannelDataService";
import { channelManager } from "../Channel/ChannelManager";
import { sessionManager } from "../Session/SessionManager";
import { SaverPool } from "../Agent/SaverPool";

const logger = LoggerService.getLogger("triggerSession.ts");

export interface TriggerSessionOptions {
    targetId: number | string | null;
    message: string;
    /**
     * 投递模式。复用 AgendaTriggerAction 的字符串值（agenda trigger 与 heartbeat 的"如何投"语义本就相同）：
     * - Notify: 仅投递文本到 channel，不进 saver（一次性提醒/外发通知）
     * - NotifyAndRecord: 投递 + 把文本以 AI 角色 + Normal kind 写入 saver（occurrence 打卡场景，AI 需看到上下文）
     * - Invoke: 把文本当作用户输入投给 AI 处理（让 AI 主动响应）
     */
    mode: AgendaTriggerAction;
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

    if (mode === AgendaTriggerAction.Invoke) {
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

    // Notify / NotifyAndRecord 都先投递文本到 channel
    const r = await channelManager.sendTextToSession(dbSessionId, message);
    if (!r.ok) return { ok: false };

    // NotifyAndRecord 额外把这条投递写入 saver，作为 AI 角色的 Normal 消息，
    // 这样后续主对话 agent 能在上下文中看到"刚才系统已经提醒过用户"，
    // 避免用户突然回复"已喝 / 已交"时 AI 上下文断裂。
    if (mode === AgendaTriggerAction.NotifyAndRecord) {
        try {
            const handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
            try {
                await handle.saver.pushMessage(
                    { role: MessageRole.AI, content: message },
                    { kind: MessageKind.Normal },
                );
            } finally {
                await handle.release();
            }
        } catch (e: any) {
            // saver 写入失败不影响投递成功——只是丢了上下文记录。记录 warn。
            logger.warn(`${tag} saver record failed: ${e?.message ?? String(e)}`);
        }
    }
    return { ok: true, channelType, sessionId };
}
