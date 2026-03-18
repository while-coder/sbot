import { SlackService } from "./SlackService";
import { AgentMessage } from "scorpio.ai";
export declare class SlackChatProvider {
    private slackService;
    private channel;
    private ts;
    private messages;
    private streamMessage;
    private tools;
    private approvalBlocks;
    private askBlocks;
    private lastUpdateTime;
    constructor(slackService: SlackService);
    init(channel: string, incomingTs: string, threadTs: string | undefined, query?: string): Promise<this>;
    private parseMessages2Text;
    addAIMessage(message: AgentMessage): Promise<void>;
    setMessage(content: string): Promise<void>;
    setStreamMessage(content: string): Promise<void>;
    resetStreamMessage(): void;
    setApprovalBlocks(blocks: any[]): Promise<void>;
    clearApprovalBlocks(): Promise<void>;
    setAskBlocks(blocks: any[]): Promise<void>;
    clearAskBlocks(): Promise<void>;
    private buildBlocks;
    private throttledUpdate;
    private flushUpdate;
}
//# sourceMappingURL=SlackChatProvider.d.ts.map