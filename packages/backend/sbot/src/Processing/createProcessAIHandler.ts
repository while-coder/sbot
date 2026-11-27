import { ProcessAIHandler } from "channel.base";
import { MessageRole, ToolApproval, type TokenUsage, type ChatMessage, saveMessageAttachments, displayMessageAttachments } from "scorpio.ai";
import { channelDataService } from "../Session/ChannelDataService";
import { config, AgentMode } from "../Core/Config";
import { buildExecuteTool } from "./buildExecuteTool";
import { updateUsageStats, type UsageContext } from "./updateUsageStats";
import { WebChatEventType, WEB_CHANNEL_ID, ApprovalTimeoutValue } from "@sbot/shared";
import { webService } from "../Channel/web/WebService";
import { channelManager } from "../Channel/ChannelManager";
import { AgentRunner } from "../Agent/AgentRunner";

export function createProcessAIHandler(): ProcessAIHandler {
    return async (query, args, sessionHandler) => {
        const dbSessionId: number = args?.dbSessionId;
        if (!dbSessionId) throw new Error("dbSessionId not specified");

        const eff = await channelDataService.getEffective(dbSessionId, true);
        if (!eff) throw new Error(`channel_session id=${dbSessionId} not found`);

        const { session: dbSession, profile, resolved } = eff;
        const { channelId } = dbSession;
        const channel = config.getChannel(channelId);
        if (!channel) throw new Error(`Channel config not found: ${channelId}`);

        const agentId = resolved.agentId;
        const saverId = resolved.saver;
        const workPath = args.workPath || resolved.workPath;
        const autoApproveAllTools = resolved.autoApproveAllTools ?? false;
        const streamVerbose = resolved.streamVerbose ?? (channelId === WEB_CHANNEL_ID);
        const approvalTimeout = resolved.approvalTimeout ?? 0;
        const approvalTimeoutValue = resolved.approvalTimeoutValue;
        const askTimeout = resolved.askTimeout ?? 0;
        const askTimeoutMessage = resolved.askTimeoutMessage;
        const disableWorkspaceContext = resolved.disableWorkspaceContext ?? false;
        const disableWorkspaceSkills = resolved.disableWorkspaceSkills ?? false;
        const disableWorkspaceMcp = resolved.disableWorkspaceMcp ?? false;
        const threadId = resolved.threadKey;  // = String(profile.id)
        if (!saverId.trim() || !config.getSaver(saverId)) {
            throw new Error("saver not specified or not configured");
        }
        query = await saveMessageAttachments(query, config.getSaverThreadDir(saverId, threadId));

        if (channelId === WEB_CHANNEL_ID) {
            const content = await displayMessageAttachments(query);
            webService.broadcast(JSON.stringify({ profileId: String(profile.id), type: WebChatEventType.Human, data: { content } }));
        }

        sessionHandler.approvalTimeoutMs = approvalTimeout > 0 ? approvalTimeout * 1000 : 0;
        sessionHandler.approvalTimeoutValue = approvalTimeoutValue === ApprovalTimeoutValue.Allow ? ToolApproval.Allow : ToolApproval.Deny;
        sessionHandler.askTimeoutMs = askTimeout > 0 ? askTimeout * 1000 : 0;
        if (askTimeoutMessage) sessionHandler.askTimeoutMessage = askTimeoutMessage;

        const extraAgentTools = args?.agentTools;
        let baseTools = await sessionHandler.buildAgentTools(args);
        const whitelist: string[] | undefined = channel.tools;
        if (whitelist !== undefined && baseTools?.length) {
            const allowedSet = new Set(whitelist);
            baseTools = baseTools.filter(t => allowedSet.has(t.name));
        }
        const agentTools = extraAgentTools?.length ? [...baseTools, ...extraAgentTools] : baseTools;

        const executeTool = buildExecuteTool(sessionHandler.session, agentId, autoApproveAllTools, (tc) => sessionHandler.executeApproval(tc));

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
        const onUsage = async (usage: TokenUsage) => {
            await updateUsageStats(usage, dbSessionId, profileId, usageContext);
        };

        const onMessage = streamVerbose
            ? (msg: ChatMessage) => sessionHandler.onChatMessage(msg, args)
            : (msg: ChatMessage) => {
                if (msg.role === MessageRole.AI && !msg.tool_calls?.length) {
                    return sessionHandler.onChatMessage(msg, args);
                }
                return Promise.resolve();
            };

        const onStreamMessage = streamVerbose
            ? (msg: ChatMessage) => sessionHandler.onStreamMessage(msg, args)
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
            channelPrompt: channelManager.getPlugin(channel.type)?.channelPrompt ?? '',
            workPath,
            disableWorkspaceContext,
            disableWorkspaceSkills,
            disableWorkspaceMcp,
            agentTools,
            memoryId: resolved.memory,
        });
    };
}
