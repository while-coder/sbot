import fs from "fs";
import { AgentToolCall, ToolApproval, ASK_TOOL_NAME, TASK_TOOL_NAME } from "scorpio.ai";
import { config } from "../Core/Config";
import { sessionManager, SessionStatus } from "channel.base";

/** 内部工具名，直接放行无需用户确认 */
const INTERNAL_TOOLS = new Set([ASK_TOOL_NAME, TASK_TOOL_NAME]);

export function buildExecuteTool(
    threadId: string,
    executeAgentTool: (toolCall: AgentToolCall) => Promise<ToolApproval>
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
        const approvedArgs = autoApproveTools[toolCall.name];
        if (approvedArgs && (approvedArgs.includes('*') || approvedArgs.includes(JSON.stringify(toolCall.args)))) {
            return ToolApproval.Allow;
        }
        sessionManager.setStatus(threadId, SessionStatus.WaitingApproval, toolCall);
        let result: ToolApproval;
        try {
            result = await executeAgentTool(toolCall);
        } finally {
            sessionManager.setStatus(threadId, SessionStatus.Thinking);
        }
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
