import type { AgentPluginContext, IAgentPlugin } from "scorpio.ai";
import type { IWikiService } from "../Service/IWikiService";
import { WikiToolProvider } from "../Tools/WikiToolProvider";

/** 将多个 Wiki 数据源作为一个能力暴露给 Agent。 */
export class WikiAgentPlugin implements IAgentPlugin {
    readonly name = "wiki";
    readonly inheritToSubAgent = true;

    constructor(private readonly services: IWikiService[]) {}

    async getDynamicSystemPrompt(ctx: AgentPluginContext): Promise<string | undefined> {
        const messages = await Promise.all(
            this.services.map(service => service.getSystemMessage(ctx.query)),
        );
        const prompt = messages.filter((message): message is string => !!message?.trim()).join("\n\n");
        return prompt || undefined;
    }

    getTools() {
        return WikiToolProvider.getTools(this.services);
    }
}
