import { ProcessAIHandler } from "channel.base";
import { MessageRole } from "scorpio.ai";
import { SessionRow, SchedulerType, database, parseMemories } from "../Core/Database";
import { buildExecuteTool } from "./buildExecuteTool";
import { updateUsageStats } from "./updateUsageStats";
import { runChannelSessionAgent } from "./runChannelSessionAgent";
import { WebChatEventType } from "sbot.commons";
import { httpServer } from "../Server/HttpServer";
import { AgentRunner } from "../Agent/AgentRunner";

export function createProcessAIHandler(): ProcessAIHandler {
    return async (query, args, sessionHandler) => {
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error("dbSessionId not specified");

        await runChannelSessionAgent({
            dbSessionId,
            query,
            buildCallbacks: (ctx) => {
                const executeTool = buildExecuteTool(
                    sessionHandler.session,
                    ctx.agentId,
                    (tc) => sessionHandler.executeApproval(tc),
                    ctx.autoApproveAllTools,
                );

                if (ctx.streamVerbose) {
                    return {
                        onMessage: (msg) => sessionHandler.onChatMessage(msg, args),
                        onStreamMessage: (msg) => sessionHandler.onStreamMessage(msg, args),
                        executeTool,
                        onUsage: async (usage) => { sessionHandler.session.recordUsage(usage); },
                    };
                }
                return {
                    onMessage: (msg) => {
                        if (msg.role === MessageRole.AI && !msg.tool_calls?.length) {
                            return sessionHandler.onChatMessage(msg, args);
                        }
                        return Promise.resolve();
                    },
                    onStreamMessage: undefined,
                    executeTool,
                    onUsage: async (usage) => { sessionHandler.session.recordUsage(usage); },
                };
            },
            extraInfo: args?.extraInfo ?? '',
            agentTools: sessionHandler.buildAgentTools(args),
        });
    };
}

export function createWebProcessAIHandler(): ProcessAIHandler {
    return async (query, args, sessionHandler) => {
        const sessionId = args?.sessionId as string;

        httpServer.broadcastToWs(JSON.stringify({ sessionId, type: WebChatEventType.Human, data: { content: query } }));

        const row = sessionId ? await database.findByPk<SessionRow>(database.session, sessionId) : undefined;
        if (!row) throw new Error(`Session "${sessionId}" not found`);

        const threadId = sessionHandler.session.threadId;
        await AgentRunner.run({
            query,
            callbacks: {
                onMessage: (msg) => sessionHandler.onChatMessage(msg, args),
                onStreamMessage: (msg) => sessionHandler.onStreamMessage(msg, args),
                executeTool: buildExecuteTool(
                    sessionHandler.session,
                    row.agent,
                    (tc) => sessionHandler.executeApproval(tc),
                    row.autoApproveAllTools,
                ),
                onUsage: async (usage) => {
                    sessionHandler.session.recordUsage(usage);
                    await updateUsageStats(usage, SchedulerType.Session, sessionId);
                },
            },
            agentId: row.agent,
            saverId: row.saver,
            threadId,
            scheduler: { schedulerType: SchedulerType.Session, schedulerId: sessionId },
            extraInfo: args?.extraInfo ?? '',
            memories: parseMemories(row.memories),
            wikis: parseMemories(row.wikis),
            workPath: row.workPath || undefined,
            agentTools: sessionHandler.buildAgentTools(args),
        });
    };
}
