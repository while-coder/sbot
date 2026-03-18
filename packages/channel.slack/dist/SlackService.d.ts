import { ILogger } from "scorpio.ai";
import { SlackActionArgs, SlackMessageArgs } from "./SlackUserServiceBase";
export interface SlackServiceOptions {
    botToken: string;
    appToken: string;
    logger?: ILogger;
    filterEvent: (eventId: string) => Promise<boolean>;
    onReceiveMessage: (userId: string, userInfo: any, args: SlackMessageArgs, query: string) => Promise<void>;
    onTriggerAction: (userId: string, args: SlackActionArgs) => Promise<void>;
}
export declare class SlackService {
    private app;
    private logger?;
    private filterEvent;
    private onReceiveMessage;
    private onTriggerAction;
    constructor(options: SlackServiceOptions);
    dispose(): void;
    sendMessage(channel: string, text: string, threadTs?: string): Promise<{
        ts: string;
        channel: string;
    }>;
    updateMessage(channel: string, ts: string, text: string, blocks?: any[]): Promise<void>;
    getUserInfo(userId: string): Promise<any>;
    registerEventHandlers(): Promise<void>;
}
//# sourceMappingURL=SlackService.d.ts.map