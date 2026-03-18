import { SlackChatProvider } from "./SlackChatProvider";
import { AgentMessage, AgentToolCall, AskResponse, AskToolParams, ToolApproval, UserServiceBase } from "scorpio.ai";
import { SlackService } from "./SlackService";
export interface SlackMessageArgs {
    slackService: SlackService;
    channel: string;
    ts: string;
    threadTs?: string;
}
export interface SlackActionArgs {
    channel: string;
    messageTs: string;
    actionId: string;
    value?: any;
}
export declare enum ToolCallStatus {
    None = "none",
    Wait = "wait",
    Allow = "allow",
    AlwaysArgs = "alwaysArgs",
    AlwaysTool = "alwaysTool",
    Deny = "deny"
}
interface ToolCallState {
    id: string | undefined;
    status: ToolCallStatus;
}
export declare abstract class SlackUserServiceBase extends UserServiceBase {
    provider: SlackChatProvider | undefined;
    slackService: SlackService;
    toolCall: ToolCallState;
    private askState;
    startProcessMessage(query: string, args: any): Promise<string>;
    processMessageError(e: any): Promise<void>;
    onAgentStreamMessage(message: AgentMessage): Promise<void>;
    onAgentMessage(message: AgentMessage): Promise<void>;
    private buildApprovalBlocks;
    executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval>;
    ask(params: AskToolParams): Promise<AskResponse>;
    onTriggerAction(args: SlackActionArgs): Promise<void>;
}
export {};
//# sourceMappingURL=SlackUserServiceBase.d.ts.map