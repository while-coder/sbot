import { ProcessAIHandler } from "channel.base";
import { MessageRole, ToolApproval, TurnSteering, type TokenUsage, type ChatMessage, type MessageContent, saveMessageAttachments, displayMessageAttachments } from "scorpio.ai";
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
        const directory = config.getSaverThreadDir(saverId, threadId);
        const publishHuman = async (input: MessageContent, steered = false) => {
            if (channelId !== WEB_CHANNEL_ID) return;
            const content = await displayMessageAttachments(input);
            webService.broadcast(JSON.stringify({ profileId: String(profile.id), type: WebChatEventType.Human, data: { content, steered } }));
        };

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

        const executeTool = buildExecuteTool(sessionHandler.session, agentId, autoApproveAllTools, (tc, signal) => sessionHandler.executeApproval(tc, signal));

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

        // ACP and remote-client transport runs have their own request lifecycle.
        const steering = channelId === WEB_CHANNEL_ID && config.getAgent(agentId).type !== AgentMode.ACP
            ? new TurnSteering()
            : undefined;
        args.registerSteering?.((input: MessageContent, onRejected: () => void) => steering?.offer({
            prepare: () => saveMessageAttachments(input, directory),
            onPersisted: content => publishHuman(content, true),
            onRejected,
        }) ?? false);

        try {
            query = await saveMessageAttachments(query, directory);
            await publishHuman(query);
            await AgentRunner.run({
                query,
                callbacks: { onMessage, onStreamMessage, executeTool, onUsage, steering },
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
        } finally {
            steering?.close();
        }
    };
}
