import { type TokenUsage } from "scorpio.ai";
import { WebChatEventType, WEB_CHANNEL_ID } from "sbot.commons";
import { database, getChannelSession } from "../Core/Database";
import { httpServer } from "../Server/HttpServer";

export interface UsageContext {
    agentId: string;
    agentName: string;
    modelId: string;
    modelName: string;
    provider: string;
    channelId: string;
}

export async function updateUsageStats(
    usage: TokenUsage,
    dbSessionId: number,
    context: UsageContext,
): Promise<void> {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;

    await database.create(database.usageLogs, {
        date,
        timestamp: now.getTime(),
        agentId: context.agentId,
        agentName: context.agentName,
        modelId: context.modelId,
        modelName: context.modelName,
        provider: context.provider,
        channelId: context.channelId,
        sessionId: dbSessionId,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
    });

    const tokenUpdate = {
        inputTokens: database.sequelize.literal(`inputTokens + ${usage.input_tokens}`),
        outputTokens: database.sequelize.literal(`outputTokens + ${usage.output_tokens}`),
        totalTokens: database.sequelize.literal(`totalTokens + ${usage.total_tokens}`),
        lastInputTokens: usage.input_tokens,
        lastOutputTokens: usage.output_tokens,
        lastTotalTokens: usage.total_tokens,
    };
    await database.update(database.channelSession, tokenUpdate, { where: { id: dbSessionId } });

    const row = await getChannelSession(dbSessionId);
    if (row && row.channelId === WEB_CHANNEL_ID) {
        httpServer.broadcastToWs(JSON.stringify({
            sessionId: row.sessionId,
            type: WebChatEventType.Usage,
            data: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead },
        }));
    }
}
