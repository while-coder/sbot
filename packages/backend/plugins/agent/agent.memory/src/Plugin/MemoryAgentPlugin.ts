import type { AgentPluginContext, AgentTurn, IAgentPlugin } from "scorpio.ai";
import type { IMemoryService } from "../Service/IMemoryService";
import { MemoryToolProvider } from "../Tools/MemoryToolProvider";

/** 将绑定 workPath 的 Memory 视图作为一个能力暴露给 Agent。 */
export class MemoryAgentPlugin implements IAgentPlugin {
    readonly name = "memory";
    readonly inheritToSubAgent = false;

    constructor(private readonly service: IMemoryService) {}

    async getDynamicSystemPrompt(): Promise<string | undefined> {
        return (await this.service.getSystemMessage()) ?? undefined;
    }

    getTools() {
        return MemoryToolProvider.getTools(this.service);
    }

    onTurnCompleted(turn: AgentTurn, _ctx: AgentPluginContext): void {
        this.service.extractFromConversation(turn.conversation);
    }
}
