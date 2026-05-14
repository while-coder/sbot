import type * as schema from "@agentclientprotocol/sdk";
import { inject } from "../../Core";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IMemoryService } from "../../Memory";
import type { MessageContent } from "../../Saver/IAgentSaverService";
import { ACPAgentServiceBase, T_ACPCommand, T_ACPArgs, T_ACPEnv, T_ACPWorkPath } from "./ACPAgentServiceBase";

export class PersistentACPAgentService extends ACPAgentServiceBase {
    private _pooled = false;
    private _onExit?: () => void;
    private sessionFirstPrompt = true;

    get pooled() { return this._pooled; }
    set pooled(v: boolean) { this._pooled = v; }

    get onPoolExit() { return this._onExit; }
    set onPoolExit(fn: (() => void) | undefined) { this._onExit = fn; }

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

    isAlive(): boolean {
        return this.childProcess !== null && this.childProcess.exitCode === null;
    }

    protected override async preparePrompt(query: MessageContent): Promise<schema.ContentBlock[]> {
        const isFirst = this.sessionFirstPrompt;
        this.sessionFirstPrompt = false;

        const blocks: schema.ContentBlock[] = [];
        if (isFirst) {
            const history = await this.saverService.getMessages();
            if (history.length > 0) blocks.push({ type: "text", text: this.formatHistory(history) });
        }
        blocks.push(...this.toContentBlocks(query));
        return blocks;
    }

    protected override onProcessExit(_code: number | null): void {
        this.sessionFirstPrompt = true;
        this._onExit?.();
    }

    protected override async ensureSession(): Promise<void> {
        if (this.sessionId) return;
        await super.ensureSession();
    }

    protected override onStreamError(_e: unknown): void {
        if (this.sessionId) {
            this.logger?.debug(`[ACP] Persistent session ${this.sessionId} failed, will recreate on next request`);
            this.sessionId = null;
            this.sessionFirstPrompt = true;
        }
    }

    override async dispose() {
        if (this._pooled) return;
        await this.forceDispose();
    }

    override async forceDispose() {
        this._pooled = false;
        await super.forceDispose();
    }
}
