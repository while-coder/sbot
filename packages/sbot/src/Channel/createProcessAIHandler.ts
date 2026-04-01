import { ProcessAIHandler, AgentToolHelpers } from "channel.base";
import { AgentRunner, createAskAgentTool, createSendFileAgentTool } from "../Agent/AgentRunner";
import { config } from "../Core/Config";
import { ChannelSessionRow, SchedulerType, database, parseMemories } from "../Core/Database";
import { buildExecuteTool } from "../UserService/buildExecuteTool";

const agentToolHelpers: AgentToolHelpers = {
    createAskTool: (channelType, askFn, supportedTypes) =>
        createAskAgentTool(channelType as any, askFn, supportedTypes),
    createSendFileTool: (channelType, sendFileFn) =>
        createSendFileAgentTool(channelType as any, sendFileFn),
};

export function createProcessAIHandler(): ProcessAIHandler {
    return async (query, args, userService) => {
        const channelId = args?.channelId as string;
        const channel = channelId ? config.getChannel(channelId) : undefined;
        if (!channel) throw new Error(`Channel "${channelId}" not found`);

        const userInfo = args?.userInfo;
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error("dbSessionId not specified");

        const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);

        const agentId = dbSession?.agentId || (channel.agent as string);
        const sessionMemories = parseMemories(dbSession?.memories);
        const memories = dbSession?.useChannelMemories
            ? [...((channel.memories as string[]) ?? []), ...sessionMemories]
            : sessionMemories;

        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: userService.onAgentMessage.bind(userService),
                onStreamMessage: userService.onAgentStreamMessage.bind(userService),
                executeTool: buildExecuteTool(
                    (userService as any).session,
                    agentId,
                    (tc) => userService.executeApproval(tc),
                ),
            },
            agentId,
            saverId: channel.saver as string,
            threadId: (userService as any).session.threadId,
            scheduler: { schedulerType: SchedulerType.Channel, schedulerId: String(dbSessionId) },
            extraInfo: userService.buildExtraInfo(userInfo),
            memories,
            workPath: dbSession?.workPath || undefined,
            agentTools: userService.buildAgentTools(args, agentToolHelpers),
        });
    };
}
