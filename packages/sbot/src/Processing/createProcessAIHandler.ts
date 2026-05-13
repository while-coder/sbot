import { ProcessAIHandler } from "channel.base";
import { MessageRole, ToolApproval } from "scorpio.ai";
import { database, ChannelSessionRow, channelThreadId, parseMemories } from "../Core/Database";
import { config, AgentMode } from "../Core/Config";
import { buildExecuteTool } from "./buildExecuteTool";
import { updateUsageStats, type UsageContext } from "./updateUsageStats";
import { WebChatEventType, WEB_CHANNEL_ID } from "sbot.commons";
import { httpServer } from "../Server/HttpServer";
import { AgentRunner } from "../Agent/AgentRunner";

export function createProcessAIHandler(): ProcessAIHandler {
    return async (query, args, sessionHandler) => {
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error("dbSessionId not specified");

        const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);
        if (!dbSession) throw new Error(`channel_session id=${dbSessionId} not found`);

        const { channelId, sessionId } = dbSession;
        const channel = config.getChannel(channelId);
        if (!channel) throw new Error(`Channel config not found: ${channelId}`);

        if (channelId === WEB_CHANNEL_ID) {
            httpServer.broadcastToWs(JSON.stringify({ sessionId, type: WebChatEventType.Human, data: { content: query } }));
        }

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
        const autoApproveAllTools = dbSession.autoApproveAllTools ?? channel.autoApproveAllTools ?? false;
        const streamVerbose = dbSession.streamVerbose ?? channel.streamVerbose ?? false;
        const threadId = channelThreadId(channel.type, channelId, sessionId);

        const silent: boolean = args?.silent ?? false;
        const extraAgentTools = args?.agentTools;
        let baseTools = sessionHandler.buildAgentTools(args);
        const whitelist: string[] | undefined = args?.toolWhitelist ?? channel.tools;
        if (whitelist?.length && baseTools?.length) {
            const allowedSet = new Set(whitelist);
            baseTools = baseTools.filter(t => allowedSet.has(t.name));
        }
        const agentTools = extraAgentTools?.length ? [...baseTools, ...extraAgentTools] : baseTools;

        const executeTool = silent
            ? async () => ToolApproval.Allow
            : buildExecuteTool(sessionHandler.session, agentId, autoApproveAllTools, (tc) => sessionHandler.executeApproval(tc));

        let usageContext: UsageContext;
        try {
            const agentEntry = config.getAgent(agentId);
            const agentModel = agentEntry.type !== AgentMode.ACP ? agentEntry.model : undefined;
            const namedModel = agentModel ? config.settings.models?.[agentModel] : undefined;
            usageContext = {
                agentId,
                agentName: agentEntry.name || agentId,
                modelId: agentModel || '',
                modelName: namedModel?.name || namedModel?.model || agentModel || '',
                provider: namedModel?.provider || '',
                channelId,
            };
        } catch {
            usageContext = { agentId, agentName: agentId, modelId: '', modelName: '', provider: '', channelId };
        }

        const onUsage = async (usage: any) => {
            if (!silent) sessionHandler.session.recordUsage(usage);
            await updateUsageStats(usage, dbSessionId, usageContext);
        };

        const onMessage = silent
            ? async (msg: any) => { args?.onMessage?.(msg); }
            : streamVerbose
                ? (msg: any) => sessionHandler.onChatMessage(msg, args)
                : (msg: any) => {
                    if (msg.role === MessageRole.AI && !msg.tool_calls?.length) {
                        return sessionHandler.onChatMessage(msg, args);
                    }
                    return Promise.resolve();
                };

        const onStreamMessage = streamVerbose
            ? (msg: any) => sessionHandler.onStreamMessage(msg, args)
            : undefined;

        const callbacks = { onMessage, onStreamMessage, executeTool, onUsage };

        await AgentRunner.run({
            query,
            callbacks,
            agentId,
            saverId,
            threadId,
            dbSessionId: String(dbSessionId),
            extraInfo: args?.extraInfo ?? '',
            memories,
            wikis,
            workPath,
            agentTools,
        });
    };
}
