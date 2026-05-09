import { createHash } from "crypto";
import { MessageRole, ToolApproval, type ChatMessage } from "scorpio.ai";
import { type HeartbeatConfig } from "sbot.commons";
import { AgentRunner } from "../Agent/AgentRunner";
import { database, ChannelSessionRow, channelThreadId } from "../Core/Database";
import { config } from "../Core/Config";
import { sessionManager } from "../Session/SessionManager";
import { loadPrompt } from "../Core/PromptLoader";
import { LoggerService } from "../Core/LoggerService";
import { runChannelSessionAgent } from "../Processing/runChannelSessionAgent";


const logger = LoggerService.getLogger("executeHeartbeat.ts");

export interface HeartbeatExecutionContext {
    heartbeatId: string;
    config: HeartbeatConfig;
    running: Set<string>;
    dedupCache: Map<string, { hash: string; ts: number }>;
}

function isInActiveHours(cfg: HeartbeatConfig): boolean {
    if (!cfg.activeHours) return true;
    const { start, end, timezone } = cfg.activeHours;
    const now = new Date();
    const hour = timezone
        ? parseInt(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }), 10)
        : now.getHours();

    if (start <= end) {
        return hour >= start && hour < end;
    }
    return hour >= start || hour < end;
}

function contentHash(text: string): string {
    return createHash('md5').update(text.trim()).digest('hex').slice(0, 16);
}

function extractText(content: ChatMessage['content']): string {
    if (typeof content === 'string') return content;
    return content.filter(p => p.type === 'text').map(p => p.text ?? '').join('');
}

export async function executeHeartbeat(ctx: HeartbeatExecutionContext): Promise<void> {
    const { heartbeatId, config: hbConfig, running, dedupCache } = ctx;
    const tag = `[heartbeat:${heartbeatId}]`;

    if (hbConfig.enabled === false) return;

    if (!isInActiveHours(hbConfig)) {
        logger.debug(`${tag} skipped: outside active hours`);
        return;
    }

    if (running.has(heartbeatId)) {
        logger.debug(`${tag} still running, skipping`);
        return;
    }

    let prompt: string;
    try {
        prompt = loadPrompt(hbConfig.promptFile);
    } catch (e: any) {
        logger.error(`${tag} failed to load prompt "${hbConfig.promptFile}": ${e?.message}`);
        return;
    }

    const okToken = hbConfig.okToken;
    const pruneOk = hbConfig.pruneOk !== false;
    const dedupHours = hbConfig.dedupHours ?? 24;

    let aiResponse = '';

    running.add(heartbeatId);
    let result;
    try {
        result = await runChannelSessionAgent({
            dbSessionId: hbConfig.target,
            query: prompt,
            buildCallbacks: () => ({
                onMessage: async (msg: ChatMessage) => {
                    if (msg.role === MessageRole.AI && !msg.tool_calls?.length) {
                        aiResponse = extractText(msg.content);
                    }
                },
                onStreamMessage: undefined,
                executeTool: async () => ToolApproval.Allow,
            }),
        });
    } finally {
        running.delete(heartbeatId);
    }

    const { saverId, threadId } = result;

    // 响应处理
    const isOk = okToken
        ? aiResponse.trim().toUpperCase().includes(okToken.toUpperCase())
        : false;

    if (isOk && pruneOk) {
        try {
            const saver = await AgentRunner.createSaverService(saverId, threadId);
            try {
                const allMessages = await saver.getAllMessages();
                if (allMessages.length >= 2) {
                    const last = allMessages[allMessages.length - 1];
                    const secondLast = allMessages[allMessages.length - 2];
                    if (last.message.role === MessageRole.AI && secondLast.message.role === MessageRole.Human) {
                        allMessages.splice(allMessages.length - 2, 2);
                        await saver.replaceAllMessages(allMessages);
                        logger.debug(`${tag} pruned ok token from history`);
                    }
                }
            } finally {
                await saver.dispose();
            }
        } catch (e: any) {
            logger.warn(`${tag} prune failed: ${e?.message}`);
        }
    } else if (!isOk && aiResponse.trim()) {
        // 有意义的响应：去重 + 通知
        const hash = contentHash(aiResponse);
        const cached = dedupCache.get(heartbeatId);
        const now = Date.now();
        const dedupWindowMs = dedupHours * 3600_000;

        if (cached && cached.hash === hash && (now - cached.ts) < dedupWindowMs) {
            logger.debug(`${tag} dedup hit, suppressing notification`);
        } else {
            dedupCache.set(heartbeatId, { hash, ts: now });

            // 转发到 notifyTargets
            const notifyTargets = hbConfig.notifyTargets ?? [];
            for (const notifyId of notifyTargets) {
                try {
                    const notifySession = await database.findByPk<ChannelSessionRow>(database.channelSession, notifyId);
                    if (!notifySession) continue;
                    const notifyChannel = config.getChannel(notifySession.channelId);
                    if (!notifyChannel) continue;
                    const notifyThreadId = channelThreadId(notifyChannel.type, notifySession.channelId, notifySession.sessionId);
                    await sessionManager.onReceiveChannelMessage(notifyThreadId, `[Heartbeat] ${aiResponse}`, {
                        channelType: notifyChannel.type,
                        channelId: notifySession.channelId,
                        dbSessionId: notifyId,
                        sessionId: notifySession.sessionId,
                        mentionBot: true,
                    });
                } catch (e: any) {
                    logger.warn(`${tag} notify to session ${notifyId} failed: ${e?.message}`);
                }
            }
        }

        logger.info(`${tag} substantive response: ${aiResponse.slice(0, 100)}...`);
    }

    await database.upsert(database.state, { key: `heartbeat_lastRun_${heartbeatId}`, value: String(Date.now()) });
}
