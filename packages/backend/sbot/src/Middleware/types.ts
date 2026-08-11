import type { MessageContent } from "scorpio.ai";
import type { ChannelMessageArgs, ChannelSessionHandler } from "channel.base";
import type { ChannelRouteArgs } from "../Session/SessionManager";
import type { AgentRunOptions } from "../Agent/AgentRunner";

export interface MessageContext {
    query: MessageContent;
    args: ChannelRouteArgs;
    threadId: string;
    filtered: boolean;
}

export interface AIContext {
    query: MessageContent;
    args: ChannelMessageArgs;
    sessionHandler: ChannelSessionHandler;
    runOptions: Partial<AgentRunOptions>;
    metadata: Record<string, any>;
}
