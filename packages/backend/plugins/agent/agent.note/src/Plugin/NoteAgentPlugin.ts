import type { AgentPluginContext, IAgentPlugin } from "scorpio.ai";
import type { INoteService } from "../Service/INoteService";
import { NoteToolProvider } from "../Tools/NoteToolProvider";

/** 将多个 Note 数据源作为一个能力暴露给 Agent。 */
export class NoteAgentPlugin implements IAgentPlugin {
    readonly name = "note";
    readonly inheritToSubAgent = true;

    constructor(private readonly services: INoteService[]) {}

    async getDynamicSystemPrompt(ctx: AgentPluginContext): Promise<string | undefined> {
        const messages = await Promise.all(
            this.services.map(service => service.getSystemMessage(ctx.query)),
        );
        const prompt = messages.filter((message): message is string => !!message?.trim()).join("\n\n");
        return prompt || undefined;
    }

    getTools() {
        return NoteToolProvider.getTools(this.services);
    }
}
