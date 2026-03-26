import fs from "fs";
import { AgentToolCall, ToolApproval, ASK_TOOL_NAME, TASK_TOOL_NAME, READ_SKILL_FILE_TOOL_NAME, EXECUTE_SKILL_SCRIPT_TOOL_NAME, LIST_SKILL_FILES_TOOL_NAME } from "scorpio.ai";
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
    threadId: string,
    executeApproval: (toolCall: AgentToolCall) => Promise<ToolApproval>
): (toolCall: AgentToolCall) => Promise<ToolApproval> {
    const settingsPath = config.getConfigPath(`sessions/${threadId}/settings.json`);
    let sessionSettings: any = {};
    try { sessionSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
    const autoApproveTools: Record<string, string[]> = sessionSettings?.approveTools ?? {};

    const saveSessionSettings = () => {
        sessionSettings.approveTools = autoApproveTools;
        fs.writeFileSync(settingsPath, JSON.stringify(sessionSettings, null, 2), 'utf-8');
    };

    return async (toolCall: AgentToolCall) => {
        if (INTERNAL_TOOLS.has(toolCall.name)) return ToolApproval.Allow;
        if (config.settings.autoApproveTools?.includes(toolCall.name)) return ToolApproval.Allow;
        const approvedArgs = autoApproveTools[toolCall.name];
        if (approvedArgs && (approvedArgs.includes('*') || approvedArgs.includes(JSON.stringify(toolCall.args)))) {
            return ToolApproval.Allow;
        }
        let result: ToolApproval;
        result = await executeApproval(toolCall);
        if (result === ToolApproval.AlwaysTool) {
            autoApproveTools[toolCall.name] = ['*'];
            saveSessionSettings();
        } else if (result === ToolApproval.AlwaysArgs) {
            const existing = autoApproveTools[toolCall.name] ?? [];
            existing.push(JSON.stringify(toolCall.args));
            autoApproveTools[toolCall.name] = existing;
            saveSessionSettings();
        }
        return result!;
    };
}
