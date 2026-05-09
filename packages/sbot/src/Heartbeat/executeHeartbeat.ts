import { MessageRole, type ChatMessage, type StoredMessage } from "scorpio.ai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { type HeartbeatConfig } from "sbot.commons";
import { AgentRunner } from "../Agent/AgentRunner";
import { database, ChannelSessionRow, channelThreadId } from "../Core/Database";
import { config } from "../Core/Config";
import { channelManager } from "../Channel/ChannelManager";
import { loadPrompt } from "../Core/PromptLoader";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../Session/SessionManager";


const logger = LoggerService.getLogger("executeHeartbeat.ts");

export interface HeartbeatExecutionContext {
    heartbeatId: string;
    config: HeartbeatConfig;
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

function extractText(content: ChatMessage['content']): string {
    if (typeof content === 'string') return content;
    return content.filter(p => p.type === 'text').map(p => p.text ?? '').join('');
}

const IDLE_TOOL_NAME = '_heartbeat_idle';

function createIdleTool(onCalled: () => void) {
    return new DynamicStructuredTool({
        name: IDLE_TOOL_NAME,
        description: 'Call this tool when everything is normal and there is nothing to report. Do NOT reply with text if you call this tool.',
        schema: z.object({}),
        func: async () => {
            onCalled();
            return 'OK';
        },
    });
}

export async function executeHeartbeat(ctx: HeartbeatExecutionContext): Promise<void> {
    const { heartbeatId, config: hbConfig } = ctx;
    const tag = `[heartbeat:${heartbeatId}]`;

    if (hbConfig.enabled === false) return;

    if (!isInActiveHours(hbConfig)) {
        logger.debug(`${tag} skipped: outside active hours`);
        return;
    }

    let prompt: string;
    try {
        prompt = loadPrompt(hbConfig.promptFile);
    } catch (e: any) {
        logger.error(`${tag} failed to load prompt "${hbConfig.promptFile}": ${e?.message}`);
        return;
    }

    const pruneIdle = hbConfig.pruneIdle !== false;

    let aiResponse = '';
    let idleCalled = false;

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

    const agentTools = [createIdleTool(() => { idleCalled = true; })];
    const toolWhitelist = [...(channel.heartbeatTools ?? []), IDLE_TOOL_NAME];
    const saverId = dbSession.saver || channel.saver;
    const threadId = channelThreadId(channel.type, dbSession.channelId, dbSession.sessionId);

    // 在 agent 运行前保存消息快照，pruneIdle 时用快照覆盖
    let snapshot: StoredMessage[] | undefined;
    if (pruneIdle) {
        try {
            const saver = await AgentRunner.createSaverService(saverId, threadId);
            try {
                snapshot = await saver.getAllMessages();
            } finally {
                await saver.dispose();
            }
        } catch (e: any) {
            logger.warn(`${tag} snapshot failed: ${e?.message}`);
        }
    }

    // 通过消息队列执行，避免与正常消息并发冲突
    await new Promise<void>((resolve, reject) => {
        sessionManager.onReceiveChannelMessage(threadId, prompt, {
            channelType: channel.type,
            channelId: dbSession.channelId,
            dbSessionId: hbConfig.target,
            sessionId: dbSession.sessionId,
            silent: true,
            agentTools,
            toolWhitelist,
            onMessage: (msg: ChatMessage) => {
                if (msg.role === MessageRole.AI && !msg.tool_calls?.length) {
                    aiResponse = extractText(msg.content);
                }
            },
            onComplete: (error?: any) => {
                if (error) reject(error);
                else resolve();
            },
        });
    });

    if (idleCalled) {
        if (pruneIdle && snapshot) {
            try {
                const saver = await AgentRunner.createSaverService(saverId, threadId);
                try {
                    await saver.replaceAllMessages(snapshot);
                    logger.debug(`${tag} idle: restored pre-heartbeat snapshot`);
                } finally {
                    await saver.dispose();
                }
            } catch (e: any) {
                logger.warn(`${tag} prune failed: ${e?.message}`);
            }
        } else {
            logger.debug(`${tag} idle: keeping history`);
        }
    } else if (aiResponse.trim() && hbConfig.notifyTargets) {
        for (const notifyId of hbConfig.notifyTargets) {
            await channelManager.sendTextToSession(notifyId, `[Heartbeat] ${aiResponse}`);
        }

        logger.info(`${tag} substantive response: ${aiResponse.slice(0, 100)}...`);
    }

    await database.upsert(database.state, { key: `heartbeat_lastRun_${heartbeatId}`, value: String(Date.now()) });
}
