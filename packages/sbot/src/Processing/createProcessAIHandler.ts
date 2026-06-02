import { ProcessAIHandler } from "channel.base";
import { MessageRole, ToolApproval } from "scorpio.ai";
import { getEffectiveSession } from "../Core/Database";
import { config, AgentMode } from "../Core/Config";
import { buildExecuteTool } from "./buildExecuteTool";
import { updateUsageStats, type UsageContext } from "./updateUsageStats";
import { WebChatEventType, WEB_CHANNEL_ID, ApprovalTimeoutValue } from "sbot.commons";
import { webService } from "../Channel/web/WebService";
import { AgentRunner } from "../Agent/AgentRunner";

export function createProcessAIHandler(): ProcessAIHandler {
    return async (query, args, sessionHandler) => {
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error("dbSessionId not specified");

        const eff = await getEffectiveSession(dbSessionId, true);
        if (!eff) throw new Error(`channel_session id=${dbSessionId} not found`);

        const { session: dbSession, profile, resolved } = eff;
        const { channelId } = dbSession;
        const channel = config.getChannel(channelId);
        if (!channel) throw new Error(`Channel config not found: ${channelId}`);

        if (channelId === WEB_CHANNEL_ID) {
            webService.broadcast(JSON.stringify({ profileId: String(profile.id), type: WebChatEventType.Human, data: { content: query } }));
        }

        const agentId = resolved.agentId;
        const saverId = resolved.saver;
        const memories = resolved.memories;
        const wikis = resolved.wikis;
        const workPath = resolved.workPath;
        const autoApproveAllTools = resolved.autoApproveAllTools ?? false;
        const streamVerbose = resolved.streamVerbose ?? (channelId === WEB_CHANNEL_ID);
        const approvalTimeout = resolved.approvalTimeout ?? 0;
        const approvalTimeoutValue = resolved.approvalTimeoutValue;
        const askTimeout = resolved.askTimeout ?? 0;
        const askTimeoutMessage = resolved.askTimeoutMessage;
        const threadId = resolved.threadKey;  // = String(profile.id)

        sessionHandler.approvalTimeoutMs = approvalTimeout > 0 ? approvalTimeout * 1000 : 0;
        sessionHandler.approvalTimeoutValue = approvalTimeoutValue === ApprovalTimeoutValue.Allow ? ToolApproval.Allow : ToolApproval.Deny;
        sessionHandler.askTimeoutMs = askTimeout > 0 ? askTimeout * 1000 : 0;
        if (askTimeoutMessage) sessionHandler.askTimeoutMessage = askTimeoutMessage;

        const silent: boolean = args?.silent ?? false;
        const extraAgentTools = args?.agentTools;
        let baseTools = sessionHandler.buildAgentTools(args);
        const whitelist: string[] | undefined = args?.toolWhitelist ?? channel.tools;
        if (whitelist !== undefined && baseTools?.length) {
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

        const profileId = profile.id;
        const onUsage = async (usage: any) => {
            if (!silent) sessionHandler.session.recordUsage(usage);
            await updateUsageStats(usage, dbSessionId, profileId, usageContext);
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
