import "reflect-metadata";
import { ChannelUserServiceBase } from "channel.base";
import { AgentRunner } from "../../Agent/AgentRunner";
import { config } from "../../Core/Config";
import { ChannelSessionRow, SchedulerType, database, parseMemories } from "../../Core/Database";
import { buildExecuteTool } from "../buildExecuteTool";

type ChannelBase = abstract new (...args: any[]) => ChannelUserServiceBase;

export function ChannelMessageMixin<TBase extends ChannelBase>(Base: TBase) {
    abstract class ChannelMessage extends Base {
        async processAIMessage(query: string, args: any): Promise<void> {
            const channelId = args?.channelId as string;
            const channel = channelId ? config.getChannel(channelId) : undefined;
            if (!channel) throw new Error(`Channel "${channelId}" not found`);

            const userInfo = args?.userInfo;
            const dbSessionId: number = args?.dbSessionId;
            if (!dbSessionId) throw new Error('dbSessionId not specified');

            const dbSession = await database.findByPk<ChannelSessionRow>(database.channelSession, dbSessionId);

            const agentId  = dbSession?.agentId  || channel.agent;
            const sessionMemories = parseMemories(dbSession?.memories);
            const memories = dbSession?.useChannelMemories
                ? [...(channel.memories ?? []), ...sessionMemories]
                : sessionMemories;

            this.threadId = this.buildThreadId(channelId, args);
            await AgentRunner.run({
                query,
                callbacks: {
                    onMessage: this.onAgentMessage.bind(this),
                    onStreamMessage: this.onAgentStreamMessage.bind(this),
                    executeTool: buildExecuteTool(this.threadId, this.executeApproval.bind(this)),
                },
                agentId,
                saverId: channel.saver,
                threadId: this.threadId,
                scheduler: { schedulerType: SchedulerType.Channel, schedulerId: String(dbSessionId) },
                extraInfo: this.buildExtraInfo(userInfo),
                memories,
                workPath: dbSession?.workPath || undefined,
                agentTools: this.buildAgentTools(args),
            });
        }
        protected abstract buildThreadId(channelId: string, args: any): string;
        protected abstract buildExtraInfo(userInfo: any): string;
        protected abstract buildAgentTools(args: any): any[];

        protected async onAgentStreamMessage(_message: any): Promise<void> {}
    }
    return ChannelMessage;
}
