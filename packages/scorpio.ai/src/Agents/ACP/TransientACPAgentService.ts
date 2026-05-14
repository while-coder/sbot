import type * as schema from "@agentclientprotocol/sdk";
import { inject } from "../../Core";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IMemoryService } from "../../Memory";
import type { MessageContent } from "../../Saver/IAgentSaverService";
import { ACPAgentServiceBase, T_ACPCommand, T_ACPArgs, T_ACPEnv, T_ACPWorkPath } from "./ACPAgentServiceBase";

export class TransientACPAgentService extends ACPAgentServiceBase {
    constructor(
        @inject(T_ACPCommand) command: string,
        @inject(T_ACPArgs) args: string[],
        @inject(T_ACPWorkPath) workPath: string,
        @inject(T_ACPEnv, { optional: true }) env?: Record<string, string>,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
    ) {
        super(command, args, workPath, env, loggerService, agentSaver, memoryServices);
    }

    protected override async preparePrompt(query: MessageContent): Promise<schema.ContentBlock[]> {
        const blocks: schema.ContentBlock[] = [];
        const history = await this.saverService.getMessages();
        if (history.length > 0) blocks.push({ type: "text", text: this.formatHistory(history) });
        blocks.push(...this.toContentBlocks(query));
        return blocks;
    }

    protected override async onStreamFinally(): Promise<void> {
        if (this.sessionId) {
            await this.connection!.closeSession({ sessionId: this.sessionId }).catch(e => {
                this.logger?.debug(`[ACP] closeSession ignored: ${e?.message ?? e}`);
            });
            this.sessionId = null;
        }
    }
}
