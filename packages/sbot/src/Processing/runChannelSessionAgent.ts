import { type StructuredToolInterface } from "@langchain/core/tools";
import { type IAgentCallback, type MessageContent, type TokenUsage } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { database, ChannelSessionRow, SchedulerType, channelThreadId, parseMemories } from "../Core/Database";
import { updateUsageStats } from "./updateUsageStats";

export interface ChannelSessionContext {
    dbSession: ChannelSessionRow;
    agentId: string;
    saverId: string;
    threadId: string;
    memories: string[];
    wikis: string[];
    workPath?: string;
    autoApproveAllTools?: boolean;
    streamVerbose?: boolean;
}

export interface RunChannelSessionAgentOptions {
    dbSessionId: number;
    query: MessageContent;
    buildCallbacks: (ctx: ChannelSessionContext) => Omit<IAgentCallback, 'onUsage'> & { onUsage?: (usage: TokenUsage) => Promise<void> };
    extraInfo?: string;
    agentTools?: StructuredToolInterface[];
}

export async function runChannelSessionAgent(options: RunChannelSessionAgentOptions): Promise<ChannelSessionContext> {
    const { dbSessionId, query, buildCallbacks, extraInfo, agentTools } = options;

    const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);
    if (!dbSession) throw new Error(`channel_session id=${dbSessionId} not found`);

    const { channelId, sessionId } = dbSession;
    const channel = config.getChannel(channelId);
    if (!channel) throw new Error(`Channel config not found: ${channelId}`);

    const agentId = dbSession.agentId || channel.agent;
    const saverId = dbSession.saver || channel.saver;
    const sessionMemories = parseMemories(dbSession.memories);
    const memories = dbSession.useChannelMemories
        ? [...(channel.memories ?? []), ...sessionMemories]
        : sessionMemories;
    const sessionWikis = parseMemories(dbSession.wikis);
    const wikis = dbSession.useChannelWikis
        ? [...(channel.wikis ?? []), ...sessionWikis]
        : sessionWikis;
    const workPath = dbSession.workPath ?? channel.workPath;
    const autoApproveAllTools = dbSession.autoApproveAllTools ?? channel.autoApproveAllTools;
    const streamVerbose = dbSession.streamVerbose ?? channel.streamVerbose ?? false;
    const threadId = channelThreadId(channel.type, channelId, sessionId);

    const ctx: ChannelSessionContext = { dbSession, agentId, saverId, threadId, memories, wikis, workPath, autoApproveAllTools, streamVerbose };
    const callbacks = buildCallbacks(ctx);
    const schedulerId = String(dbSessionId);

    await AgentRunner.run({
        query,
        callbacks: {
            ...callbacks,
            onUsage: async (usage) => {
                await callbacks.onUsage?.(usage);
                await updateUsageStats(usage, SchedulerType.Channel, schedulerId);
            },
        },
        agentId,
        saverId,
        threadId,
        scheduler: { schedulerType: SchedulerType.Channel, schedulerId },
        extraInfo: extraInfo ?? '',
        memories,
        wikis,
        workPath,
        agentTools,
    });

    return ctx;
}
