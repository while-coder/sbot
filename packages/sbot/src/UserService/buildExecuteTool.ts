import { ChatToolCall, ToolApproval, ASK_TOOL_NAME, TASK_TOOL_NAME, READ_SKILL_FILE_TOOL_NAME, EXECUTE_SKILL_SCRIPT_TOOL_NAME, LIST_SKILL_FILES_TOOL_NAME } from "scorpio.ai";
import { SessionService } from "channel.base";
import { SEND_FILE_TOOL_NAME } from "../Agent/AgentRunner";
import { config } from "../Core/Config";

/** 内部工具名，直接放行无需用户确认 */
const INTERNAL_TOOLS = new Set([
    ASK_TOOL_NAME,
    TASK_TOOL_NAME,
    // SkillService 工具
    READ_SKILL_FILE_TOOL_NAME,
    EXECUTE_SKILL_SCRIPT_TOOL_NAME,
    LIST_SKILL_FILES_TOOL_NAME,
    // 渠道内置工具
    SEND_FILE_TOOL_NAME,
]);

export function buildExecuteTool(
    session: SessionService,
    agentId: string,
    executeApproval: (toolCall: ChatToolCall) => Promise<ToolApproval>
): (toolCall: ChatToolCall) => Promise<ToolApproval> {
    const { settings } = session;
    if (!settings.approveTools) settings.approveTools = {};
    const approveTools = settings.approveTools;
    const agentEntry = config.getAgent(agentId);
    const agentAutoApprove = agentEntry?.autoApproveTools;
    const agentAutoApproveAll = agentEntry?.autoApproveAllTools;

    return async (toolCall: ChatToolCall) => {
        if (INTERNAL_TOOLS.has(toolCall.name)) return ToolApproval.Allow;
        if (config.settings.autoApproveAllTools) return ToolApproval.Allow;
        if (config.settings.autoApproveTools?.includes(toolCall.name)) return ToolApproval.Allow;
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
