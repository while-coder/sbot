import { ProcessAIHandler, ChannelToolHelpers } from "channel.base";
import { AgentRunner, createAskAgentTool, createSendFileAgentTool } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, SchedulerType, database, parseMemories } from "../Core/Database";
import { buildExecuteTool } from "../UserService/buildExecuteTool";
import { WebChatEventType } from "sbot.commons";
import { httpServer } from "../Server/HttpServer";

const agentToolHelpers: ChannelToolHelpers = {
    createAskTool: (prompt, askFn, supportedTypes) =>
        createAskAgentTool(prompt, askFn, supportedTypes),
    createSendFileTool: (prompt, sendFileFn) =>
        createSendFileAgentTool(prompt, sendFileFn),
};

function runAgent(query: string, args: any, userService: any, agentId: string, saverId: string, schedulerType: SchedulerType, schedulerId: string, memories: string[], workPath?: string): Promise<void> {
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
        },
        agentId,
        saverId,
        threadId: userService.session.threadId,
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

        // Echo the human message back to the WebSocket client
        httpServer.broadcastToWs(JSON.stringify({ type: WebChatEventType.Human, content: query, sessionId }));

        const sessionCfg = sessionId ? config.getSession(sessionId) : undefined;
        if (!sessionCfg) throw new Error(`Session "${sessionId}" not found`);

        const { agent: agentId, saver: saverId, memories, workPath } = sessionCfg;

        await runAgent(query, args, userService, agentId, saverId,
            SchedulerType.Session, sessionId, memories ?? [], workPath);
    };
}
