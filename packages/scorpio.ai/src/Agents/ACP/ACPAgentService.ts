import { ChildProcess, spawn } from "child_process";
import { Readable, Writable } from "stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { inject } from "../../Core";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IMemoryService } from "../../Memory";
import { AgentServiceBase, IAgentCallback, AgentCancelledError, ChatMessage, MessageRole, ToolApproval } from "../AgentServiceBase";
import type { MessageContent } from "../../Saver/IAgentSaverService";
import { contentToString } from "../../Utils/contentUtils";
import { v4 as uuidv4 } from "uuid";

export const T_ACPCommand = Symbol("scorpio:T_ACPCommand");
export const T_ACPArgs = Symbol("scorpio:T_ACPArgs");
export const T_ACPEnv = Symbol("scorpio:T_ACPEnv");
export const T_ACPSessionMode = Symbol("scorpio:T_ACPSessionMode");
export const T_ACPWorkPath = Symbol("scorpio:T_ACPWorkPath");

export enum ACPSessionMode {
    Transient = "transient",
    Persistent = "persistent",
}

export class ACPAgentService extends AgentServiceBase {
    private command: string;
    private args: string[];
    private env: Record<string, string>;
    private sessionMode: ACPSessionMode;
    private workPath: string;

    private childProcess: ChildProcess | null = null;
    private connection: ClientSideConnection | null = null;
    private sessionId: string | null = null;
    private initialized = false;
    private sessionFirstPrompt = true;

    private _callback: IAgentCallback = {};
    private _text = "";
    private _thinkId = "";

    private _pooled = false;
    onExit?: () => void;

    get pooled() { return this._pooled; }
    set pooled(v: boolean) { this._pooled = v; }

    isAlive(): boolean {
        return this.childProcess !== null && this.childProcess.exitCode === null;
    }

    constructor(
        @inject(T_ACPCommand) command: string,
        @inject(T_ACPArgs) args: string[],
        @inject(T_ACPWorkPath) workPath: string,
        @inject(T_ACPSessionMode) sessionMode: ACPSessionMode,
        @inject(T_ACPEnv, { optional: true }) env?: Record<string, string>,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
        @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
        @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.command = command;
        this.args = args;
        this.env = env ?? {};
        this.sessionMode = sessionMode;
        this.workPath = workPath;
    }

    override async stream(query: MessageContent, callback: IAgentCallback, signal?: AbortSignal): Promise<ChatMessage[]> {
        if (signal?.aborted) throw new AgentCancelledError();

        await this.ensureReady();
        const isFirstPrompt = this.sessionFirstPrompt;
        this.sessionFirstPrompt = false;

        const previousHistory = isFirstPrompt ? await this.saverService.getMessages() : [];
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        this._callback = callback;
        this._text = "";
        this._thinkId = uuidv4();

        const onCancel = () => {
            if (this.sessionId && this.connection) {
                this.connection.cancel({ sessionId: this.sessionId });
            }
        };
        signal?.addEventListener("abort", onCancel, { once: true });

        const messages: ChatMessage[] = [];

        try {
            const promptBlocks: schema.ContentBlock[] = [];
            if (isFirstPrompt && previousHistory.length > 0) {
                promptBlocks.push({ type: "text", text: this.formatHistory(previousHistory) });
            }
            promptBlocks.push(...this.buildPromptBlocks(query));

            const response = await this.connection!.prompt({
                sessionId: this.sessionId!,
                prompt: promptBlocks,
            });

            if (this._text.trim()) {
                const msg: ChatMessage = {
                    role: MessageRole.AI,
                    content: this._text.trim(),
                    additional_kwargs: { thinkId: this._thinkId },
                };
                messages.push(msg);
                await callback.onMessage?.(msg);
                await this.saverService.pushMessage(msg, { thinkId: this._thinkId });
            }

            if (response.usage) {
                await callback.onUsage?.({
                    input_tokens: response.usage.inputTokens ?? 0,
                    output_tokens: response.usage.outputTokens ?? 0,
                    total_tokens: (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0),
                });
            }
        } finally {
            signal?.removeEventListener("abort", onCancel);
            this._callback = {};
            if (this.sessionMode === ACPSessionMode.Transient && this.sessionId) {
                await this.connection!.closeSession({ sessionId: this.sessionId }).catch(e => {
                    this.logger?.debug(`[ACP] closeSession ignored: ${e?.message ?? e}`);
                });
                this.sessionId = null;
            }
        }

        return messages;
    }

    override async dispose() {
        if (this._pooled) return;
        await this.forceDispose();
    }

    async forceDispose() {
        if (this.sessionId && this.connection) {
            await this.connection.closeSession({ sessionId: this.sessionId }).catch(e => {
                this.logger?.debug(`[ACP] closeSession ignored: ${e?.message ?? e}`);
            });
            this.sessionId = null;
        }
        if (this.childProcess) {
            this.childProcess.kill();
            this.childProcess = null;
        }
        this.connection = null;
        this.initialized = false;
        this._pooled = false;
        await super.dispose();
    }

    private async ensureReady(): Promise<void> {
        if (!this.connection || !this.initialized) {
            this.childProcess = spawn(this.command, this.args, {
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env, ...this.env },
                shell: process.platform === "win32",
            });

            this.childProcess.stderr?.on("data", (chunk: Buffer) => {
                this.logger?.debug(`[ACP stderr] ${chunk.toString().trim()}`);
            });

            this.childProcess.on("exit", (code) => {
                this.logger?.info(`[ACP] process exited with code ${code}`);
                this.connection = null;
                this.initialized = false;
                this.sessionId = null;
                this.sessionFirstPrompt = true;
                this.onExit?.();
            });

            const stdout = this.childProcess.stdout!;
            const stdin = this.childProcess.stdin!;

            const stream = ndJsonStream(
                Writable.toWeb(stdin) as WritableStream<Uint8Array>,
                Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
            );

            const self = this;

            this.connection = new ClientSideConnection(
                () => ({
                    async requestPermission(params: schema.RequestPermissionRequest) {
                        if (!self._callback.executeTool) {
                            const allowOption = params.options.find(o => o.kind === "allow_once") ?? params.options[0];
                            return { outcome: { outcome: "selected" as const, optionId: allowOption.optionId } };
                        }
                        const toolCall = {
                            id: params.toolCall.toolCallId,
                            name: params.toolCall.title ?? "unknown",
                            args: (params.toolCall.rawInput as Record<string, any>) ?? {},
                        };
                        const approval = await self._callback.executeTool(toolCall);
                        if (approval === ToolApproval.Deny) {
                            const rejectOption = params.options.find(o => o.kind === "reject_once");
                            if (rejectOption) {
                                return { outcome: { outcome: "selected" as const, optionId: rejectOption.optionId } };
                            }
                            return { outcome: { outcome: "cancelled" as const } };
                        }
                        const alwaysOption = params.options.find(o => o.kind === "allow_always");
                        const allowOption = params.options.find(o => o.kind === "allow_once") ?? params.options[0];
                        const selectedOption = (approval === ToolApproval.AlwaysArgs || approval === ToolApproval.AlwaysTool)
                            ? (alwaysOption ?? allowOption)
                            : allowOption;
                        return { outcome: { outcome: "selected" as const, optionId: selectedOption.optionId } };
                    },

                    async sessionUpdate(params: schema.SessionNotification) {
                        const update = params.update;
                        switch (update.sessionUpdate) {
                            case "agent_message_chunk": {
                                if (update.content.type === "text") {
                                    self._text += (update.content as schema.TextContent).text ?? "";
                                    await self._callback.onStreamMessage?.({ role: MessageRole.AI, content: self._text });
                                }
                                break;
                            }
                            case "tool_call": {
                                const tc = update as schema.ToolCall & { sessionUpdate: string };
                                await self.flushThinkText();
                                await self.saverService.pushThinkMessage(self._thinkId, {
                                    role: MessageRole.AI,
                                    content: `[Tool: ${tc.title}]`,
                                    tool_calls: [{ id: tc.toolCallId, name: tc.title, args: (tc.rawInput as Record<string, any>) ?? {} }],
                                });
                                await self._callback.onStreamMessage?.({ role: MessageRole.AI, content: `[Tool: ${tc.title}]` });
                                break;
                            }
                            case "tool_call_update": {
                                const tu = update as schema.ToolCallUpdate & { sessionUpdate: string };
                                if (tu.status === "completed" || tu.status === "failed") {
                                    const raw = tu.rawOutput;
                                    const output = raw != null ? (typeof raw === "string" ? raw : JSON.stringify(raw)) : "";
                                    await self.saverService.pushThinkMessage(self._thinkId, {
                                        role: MessageRole.Tool,
                                        tool_call_id: tu.toolCallId,
                                        content: output,
                                        status: tu.status === "failed" ? "error" : "success",
                                    });
                                }
                                break;
                            }
                            case "usage_update": {
                                const u = update as any;
                                if (u.usage) {
                                    await self._callback.onUsage?.({
                                        input_tokens: u.usage.inputTokens ?? 0,
                                        output_tokens: u.usage.outputTokens ?? 0,
                                        total_tokens: (u.usage.inputTokens ?? 0) + (u.usage.outputTokens ?? 0),
                                    });
                                }
                                break;
                            }
                        }
                    },
                }),
                stream,
            );

            await this.connection.initialize({
                protocolVersion: 1,
                clientCapabilities: {},
                clientInfo: { name: "sbot", version: "1.0.0" },
            });
            this.initialized = true;
        }

        if (!(this.sessionMode === ACPSessionMode.Persistent && this.sessionId)) {
            const response = await this.connection.newSession({
                cwd: this.workPath,
                mcpServers: [],
            });
            this.sessionId = response.sessionId;
        }
    }

    private async flushThinkText(): Promise<void> {
        const pending = this._text.trim();
        if (!pending) return;
        await this.saverService.pushThinkMessage(this._thinkId, { role: MessageRole.AI, content: pending });
        this._text = "";
    }

    private formatHistory(messages: ChatMessage[]): string {
        const lines: string[] = [];
        for (const msg of messages) {
            const text = contentToString(msg.content);
            if (!text) continue;
            const role = msg.role === MessageRole.Human ? "user"
                       : msg.role === MessageRole.AI ? "assistant"
                       : msg.role;
            lines.push(`[${role}]: ${text}`);
        }
        return `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>`;
    }

    private buildPromptBlocks(query: MessageContent): schema.ContentBlock[] {
        if (typeof query === "string") {
            return [{ type: "text", text: query }];
        }
        return (query as Array<{ type: string; text?: string; [k: string]: any }>).map(block => {
            if (block.type === "text") {
                return { type: "text" as const, text: block.text ?? "" };
            }
            if (block.type === "image_url" || block.type === "image") {
                return {
                    type: "image" as const,
                    data: block.image_url?.url ?? block.data ?? "",
                    mimeType: block.mimeType ?? "image/png",
                };
            }
            return { type: "text" as const, text: JSON.stringify(block) };
        });
    }
}
