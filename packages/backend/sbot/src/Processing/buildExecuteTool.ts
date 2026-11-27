import { ChatToolCall, ToolApproval, SPAWN_AGENT_TOOL_NAME } from "scorpio.ai";
import { SessionService } from "channel.base";
import { AgentMode, config } from "../Core/Config";

export function buildExecuteTool(
    session: SessionService,
    agentId: string,
    sessionAutoApproveAll: boolean,
    executeApproval: (toolCall: ChatToolCall) => Promise<ToolApproval>,
): (toolCall: ChatToolCall) => Promise<ToolApproval> {
    const { settings } = session;
    if (!settings.approveTools) settings.approveTools = {};
    const approveTools = settings.approveTools;
    const agentEntry = config.getAgent(agentId);
    const agentAutoApprove = agentEntry?.autoApproveTools;
    const agentAutoApproveAll = agentEntry?.autoApproveAllTools;

    return async (toolCall: ChatToolCall) => {
        if (agentEntry.type === AgentMode.ReAct && toolCall.name === SPAWN_AGENT_TOOL_NAME) return ToolApproval.Allow;
        if (config.settings.autoApproveAllTools) return ToolApproval.Allow;
        if (config.settings.autoApproveTools?.includes(toolCall.name)) return ToolApproval.Allow;
        if (sessionAutoApproveAll) return ToolApproval.Allow;
        if (agentAutoApproveAll) return ToolApproval.Allow;
        if (agentAutoApprove?.includes(toolCall.name)) return ToolApproval.Allow;
        const approvedArgs = approveTools[toolCall.name];
        if (approvedArgs && (approvedArgs.includes('*') || approvedArgs.includes(JSON.stringify(toolCall.args)))) {
            return ToolApproval.Allow;
        }
        const result = await executeApproval(toolCall);
        if (result === ToolApproval.AlwaysTool) {
            approveTools[toolCall.name] = ['*'];
            session.saveSettings();
        } else if (result === ToolApproval.AlwaysArgs) {
            const existing = approveTools[toolCall.name] ?? [];
            existing.push(JSON.stringify(toolCall.args));
            approveTools[toolCall.name] = existing;
            session.saveSettings();
        }
        return result;
    };
}
