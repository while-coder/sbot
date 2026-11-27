import type { AgentPluginContext, AgentTurn, IAgentPlugin } from "scorpio.ai";
import type { IMemoryService } from "../Service/IMemoryService";

/** 将绑定 workPath 的 Memory 视图作为一个能力暴露给 Agent。 */
export class MemoryAgentPlugin implements IAgentPlugin {
    readonly name = "memory";
    readonly inheritToSubAgent = false;

    constructor(private readonly service: IMemoryService) {}

    async getDynamicSystemPrompt(ctx: AgentPluginContext): Promise<string | undefined> {
        return (await this.service.getSystemMessage(ctx.query)) ?? undefined;
    }

    onTurnCompleted(turn: AgentTurn, _ctx: AgentPluginContext): void {
        this.service.extractFromConversation(turn.conversation);
    }
}
