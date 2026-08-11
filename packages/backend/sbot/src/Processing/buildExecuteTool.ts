import { ChatToolCall, ToolApproval, DISPATCH_TASK_TOOL_NAME } from "scorpio.ai";
import { NOTE_SEARCH_TOOL_NAME } from "agent.note";
import { WIKI_SEARCH_TOOL_NAME, WIKI_READ_TOOL_NAME } from "agent.wiki";
import { AGENDA_CREATE_TOOL_NAME, AGENDA_LIST_TOOL_NAME, AGENDA_GET_TOOL_NAME, AGENDA_EDIT_TOOL_NAME, AGENDA_CLOSE_TOOL_NAME, AGENDA_WIKI_TOOL_NAME } from "agent.agenda";
import { READ_SKILL_FILE_TOOL_NAME, EXECUTE_SKILL_SCRIPT_TOOL_NAME, LIST_SKILL_FILES_TOOL_NAME } from "agent.skill";
import { SessionService, ASK_TOOL_NAME, SEND_FILE_TOOL_NAME } from "channel.base";
import { config } from "../Core/Config";

/** 内部工具名，直接放行无需用户确认 */
const INTERNAL_TOOLS = new Set([
    ASK_TOOL_NAME,
    DISPATCH_TASK_TOOL_NAME,
    // SkillService 工具
    READ_SKILL_FILE_TOOL_NAME,
    EXECUTE_SKILL_SCRIPT_TOOL_NAME,
    LIST_SKILL_FILES_TOOL_NAME,
    // 渠道内置工具
    SEND_FILE_TOOL_NAME,
    // Agenda 工具
    AGENDA_CREATE_TOOL_NAME,
    AGENDA_LIST_TOOL_NAME,
    AGENDA_GET_TOOL_NAME,
    AGENDA_EDIT_TOOL_NAME,
    AGENDA_CLOSE_TOOL_NAME,
    AGENDA_WIKI_TOOL_NAME,
    // Note 工具
    NOTE_SEARCH_TOOL_NAME,
    // Wiki 工具
    WIKI_SEARCH_TOOL_NAME,
    WIKI_READ_TOOL_NAME,
]);

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
        if (INTERNAL_TOOLS.has(toolCall.name)) return ToolApproval.Allow;
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
