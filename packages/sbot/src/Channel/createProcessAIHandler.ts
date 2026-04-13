import { ProcessAIHandler, ChannelToolHelpers, type MessageContent } from "channel.base";
import { AgentRunner, createAskAgentTool, createSendFileAgentTool } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, SessionRow, SchedulerType, database, parseMemories } from "../Core/Database";
import { buildExecuteTool } from "../UserService/buildExecuteTool";
import { WebChatEventType } from "sbot.commons";
import { httpServer } from "../Server/HttpServer";

const agentToolHelpers: ChannelToolHelpers = {
    createAskTool: (prompt, askFn, supportedTypes) =>
        createAskAgentTool(prompt, askFn, supportedTypes),
    createSendFileTool: (prompt, sendFileFn) =>
        createSendFileAgentTool(prompt, sendFileFn),
};

function runAgent(query: MessageContent, args: any, userService: any, agentId: string, saverId: string, schedulerType: SchedulerType, schedulerId: string, memories: string[], workPath?: string): Promise<void> {
    const threadId = userService.session.threadId;
    return AgentRunner.run({
        query,
        callbacks: {
            onMessage: (msg) => userService.onChatMessage(msg, args),
            onStreamMessage: (msg) => userService.onStreamMessage(msg, args),
            executeTool: buildExecuteTool(
                userService.session,
                agentId,
                (tc) => userService.executeApproval(tc),
            ),
            onUsage: async (usage) => {
                userService.session.recordUsage(usage);
                const today = new Date().toISOString().slice(0, 10);
                const [, created] = await database.findOrCreate(database.usageStats, {
                    where: { date: today },
                    defaults: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens },
                });
                if (!created) {
                    await database.update(database.usageStats, {
                        inputTokens: database.sequelize.literal(`inputTokens + ${usage.input_tokens}`),
                        outputTokens: database.sequelize.literal(`outputTokens + ${usage.output_tokens}`),
                        totalTokens: database.sequelize.literal(`totalTokens + ${usage.total_tokens}`),
                    }, { where: { date: today } });
                }
                // 增量更新 session 行的累计 token + last token
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
                }
            },
        },
        agentId,
        saverId,
        threadId,
        scheduler: { schedulerType, schedulerId },
        extraInfo: args?.extraInfo ?? '',
        memories,
        workPath,
        agentTools: userService.buildAgentTools(args, agentToolHelpers),
    });
}

export function createProcessAIHandler(): ProcessAIHandler {
    return async (query, args, userService) => {
        const channelId = args?.channelId as string;
        const channel = channelId ? config.getChannel(channelId) : undefined;
        if (!channel) throw new Error(`Channel "${channelId}" not found`);

        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error("dbSessionId not specified");

        const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);

        const agentId = dbSession?.agentId || (channel.agent as string);
        const sessionMemories = parseMemories(dbSession?.memories);
        const memories = dbSession?.useChannelMemories
            ? [...((channel.memories as string[]) ?? []), ...sessionMemories]
            : sessionMemories;

        await runAgent(query, args, userService, agentId, channel.saver as string,
            SchedulerType.Channel, String(dbSessionId), memories, dbSession?.workPath || undefined);
    };
}

export function createWebProcessAIHandler(): ProcessAIHandler {
    return async (query, args, userService) => {
        const sessionId = args?.sessionId as string;

        // Echo the human message back to the WebSocket client (preserves multimodal content)
        httpServer.broadcastToWs(JSON.stringify({ sessionId, type: WebChatEventType.Human, data: { content: query } }));

        const row = sessionId ? await database.findByPk<SessionRow>(database.session, sessionId) : undefined;
        if (!row) throw new Error(`Session "${sessionId}" not found`);

        await runAgent(query, args, userService, row.agent, row.saver,
            SchedulerType.Session, sessionId, parseMemories(row.memories), row.workPath || undefined);
    };
}
