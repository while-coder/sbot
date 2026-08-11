import type {
    AgentPluginContext,
    AgentTurn,
    IAgentPlugin,
} from "scorpio.ai";
import { AgendaToolProvider } from "../Tools/AgendaToolProvider";
import type { IAgendaService } from "../Service/IAgendaService";

/** Agent-facing adapter for the Agenda capability. */
export class AgendaAgentPlugin implements IAgentPlugin {
    readonly name = "agenda";
    readonly inheritToSubAgent = false;

    constructor(private readonly service: IAgendaService) {}

    getTools(ctx: AgentPluginContext) {
        return AgendaToolProvider.getTools(this.service, ctx.channelSessionId);
    }

    onTurnCompleted(turn: AgentTurn, ctx: AgentPluginContext): void {
        this.service.extractFromConversation(turn.conversation, ctx.channelSessionId);
    }
}
