import { type TokenUsage } from "scorpio.ai";
import { WebChatEventType } from "sbot.commons";
import { SchedulerType, database } from "../Core/Database";
import { httpServer } from "../Server/HttpServer";

export async function updateUsageStats(
    usage: TokenUsage,
    schedulerType: SchedulerType,
    schedulerId: string,
): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;

    const [, created] = await database.findOrCreate(database.usageStats, {
        where: { date: today },
        defaults: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead },
    });
    if (!created) {
        await database.update(database.usageStats, {
            inputTokens: database.sequelize.literal(`inputTokens + ${usage.input_tokens}`),
            outputTokens: database.sequelize.literal(`outputTokens + ${usage.output_tokens}`),
            totalTokens: database.sequelize.literal(`totalTokens + ${usage.total_tokens}`),
            cacheCreationTokens: database.sequelize.literal(`cacheCreationTokens + ${cacheCreation}`),
            cacheReadTokens: database.sequelize.literal(`cacheReadTokens + ${cacheRead}`),
        }, { where: { date: today } });
    }

    const tokenUpdate = {
        inputTokens: database.sequelize.literal(`inputTokens + ${usage.input_tokens}`),
        outputTokens: database.sequelize.literal(`outputTokens + ${usage.output_tokens}`),
        totalTokens: database.sequelize.literal(`totalTokens + ${usage.total_tokens}`),
        lastInputTokens: usage.input_tokens,
        lastOutputTokens: usage.output_tokens,
        lastTotalTokens: usage.total_tokens,
    };
    if (schedulerType === SchedulerType.Channel) {
        await database.update(database.channelSession, tokenUpdate, { where: { id: Number(schedulerId) } });
    } else {
        await database.update(database.session, tokenUpdate, { where: { id: schedulerId } });
        httpServer.broadcastToWs(JSON.stringify({
            sessionId: schedulerId,
            type: WebChatEventType.Usage,
            data: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead },
        }));
    }
}
