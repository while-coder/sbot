import { ChildProcess, spawn } from "child_process";
import { Readable, Writable } from "stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IMemoryService } from "../../Memory";
import { AgentServiceBase, IAgentCallback, AgentCancelledError, ChatMessage, MessageRole, ToolApproval } from "../AgentServiceBase";
import type { MessageContent } from "../../Saver/IAgentSaverService";

import { v4 as uuidv4 } from "uuid";

export const T_ACPCommand = Symbol("scorpio:T_ACPCommand");
export const T_ACPArgs = Symbol("scorpio:T_ACPArgs");
export const T_ACPEnv = Symbol("scorpio:T_ACPEnv");
export const T_ACPWorkPath = Symbol("scorpio:T_ACPWorkPath");

export abstract class ACPAgentServiceBase extends AgentServiceBase {
    protected command: string;
    protected args: string[];
    protected env: Record<string, string>;
    protected workPath: string;

    protected childProcess: ChildProcess | null = null;
    protected connection: ClientSideConnection | null = null;
    protected sessionId: string | null = null;
    protected initialized = false;

    private _callback: IAgentCallback = {};
    private _text = "";
    private _thinkId = "";
    private _usageReported = false;

    constructor(
        command: string,
        args: string[],
        workPath: string,
        env?: Record<string, string>,
        loggerService?: ILoggerService,
        agentSaver?: IAgentSaverService,
        memoryServices?: IMemoryService[],
    ) {
        super(loggerService, agentSaver, memoryServices);
        this.command = command;
        this.args = args;
        this.env = env ?? {};
        this.workPath = workPath;
    }

    // ── stream ───────────────────────────────────────────────────────────

    override async stream(query: MessageContent, callback: IAgentCallback, signal?: AbortSignal): Promise<ChatMessage[]> {
        if (signal?.aborted) throw new AgentCancelledError();
        await this.ensureReady();

        const prompt = await this.preparePrompt(query);
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        this._callback = callback;
        this._text = "";
        this._thinkId = uuidv4();
        this._usageReported = false;

        const onCancel = () => {
            if (this.sessionId && this.connection) this.connection.cancel({ sessionId: this.sessionId });
        };
        signal?.addEventListener("abort", onCancel, { once: true });

        try {
            const response = await this.connection!.prompt({ sessionId: this.sessionId!, prompt });
            return await this.collectResponse(response, callback);
        } catch (e) {
            this.onStreamError(e);
            throw e;
        } finally {
            signal?.removeEventListener("abort", onCancel);
            this._callback = {};
            await this.onStreamFinally();
        }
    }

    protected onStreamError(_e: unknown): void {}
    protected async onStreamFinally(): Promise<void> {}

    // ── dispose ──────────────────────────────────────────────────────────

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
        await super.dispose();
    }

    override async dispose() {
        await this.forceDispose();
    }

    // ── connection / session ─────────────────────────────────────────────

    protected async ensureReady(): Promise<void> {
        await this.ensureConnection();
        await this.ensureSession();
    }

    protected async ensureSession(): Promise<void> {
        const response = await this.connection!.newSession({ cwd: this.workPath, mcpServers: [] });
        this.sessionId = response.sessionId;
    }

    protected onProcessExit(_code: number | null): void {}

    private async ensureConnection(): Promise<void> {
        if (this.connection && this.initialized) return;

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
            this.onProcessExit(code);
        });

        const stream = ndJsonStream(
            Writable.toWeb(this.childProcess.stdin!) as WritableStream<Uint8Array>,
            Readable.toWeb(this.childProcess.stdout!) as ReadableStream<Uint8Array>,
        );

        this.connection = new ClientSideConnection(
            () => ({
                requestPermission: (p: schema.RequestPermissionRequest) => this.handlePermission(p),
                sessionUpdate: (p: schema.SessionNotification) => this.handleSessionUpdate(p),
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

    // ── prompt / response helpers ────────────────────────────────────────

    protected abstract preparePrompt(query: MessageContent): Promise<schema.ContentBlock[]>;

    private async collectResponse(response: { usage?: schema.Usage | null }, callback: IAgentCallback): Promise<ChatMessage[]> {
        const messages: ChatMessage[] = [];
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
        if (response.usage && !this._usageReported) {
            await callback.onUsage?.({
                input_tokens: response.usage.inputTokens ?? 0,
                output_tokens: response.usage.outputTokens ?? 0,
                total_tokens: (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0),
            });
        }
        return messages;
    }

    // ── ACP session handlers ─────────────────────────────────────────────

    private async handlePermission(params: schema.RequestPermissionRequest) {
        if (!this._callback.executeTool) {
            const opt = params.options.find(o => o.kind === "allow_once") ?? params.options[0];
            return { outcome: { outcome: "selected" as const, optionId: opt.optionId } };
        }

        const toolCall = {
            id: params.toolCall.toolCallId,
            name: params.toolCall.title ?? "unknown",
            args: (params.toolCall.rawInput as Record<string, any>) ?? {},
        };
        const approval = await this._callback.executeTool(toolCall);

        if (approval === ToolApproval.Deny) {
            const reject = params.options.find(o => o.kind === "reject_once");
            return reject
                ? { outcome: { outcome: "selected" as const, optionId: reject.optionId } }
                : { outcome: { outcome: "cancelled" as const } };
        }

        const always = params.options.find(o => o.kind === "allow_always");
        const allow = params.options.find(o => o.kind === "allow_once") ?? params.options[0];
        const selected = (approval === ToolApproval.AlwaysArgs || approval === ToolApproval.AlwaysTool)
            ? (always ?? allow) : allow;
        return { outcome: { outcome: "selected" as const, optionId: selected.optionId } };
    }

    private async handleSessionUpdate(params: schema.SessionNotification) {
        const update = params.update;
        switch (update.sessionUpdate) {
            case "agent_message_chunk": {
                if (update.content.type === "text") {
                    this._text += (update.content as schema.TextContent).text ?? "";
                    await this._callback.onStreamMessage?.({ role: MessageRole.AI, content: this._text });
                }
                break;
            }
            case "tool_call": {
                const tc = update as schema.ToolCall & { sessionUpdate: string };
                await this.flushThinkText();
                await this.saverService.pushThinkMessage(this._thinkId, {
                    role: MessageRole.AI,
                    content: `[Tool: ${tc.title}]`,
                    tool_calls: [{ id: tc.toolCallId, name: tc.title, args: (tc.rawInput as Record<string, any>) ?? {} }],
                });
                await this._callback.onStreamMessage?.({ role: MessageRole.AI, content: `[Tool: ${tc.title}]` });
                break;
            }
            case "tool_call_update": {
                const tu = update as schema.ToolCallUpdate & { sessionUpdate: string };
                if (tu.status === "completed" || tu.status === "failed") {
                    const raw = tu.rawOutput;
                    const output = raw != null ? (typeof raw === "string" ? raw : JSON.stringify(raw)) : "";
                    await this.saverService.pushThinkMessage(this._thinkId, {
                        role: MessageRole.Tool,
                        tool_call_id: tu.toolCallId,
                        content: output,
                        status: tu.status === "failed" ? "error" : "success",
                    });
                    await this._callback.onStreamMessage?.({ role: MessageRole.Tool, content: output, tool_call_id: tu.toolCallId });
                }
                break;
            }
            case "usage_update": {
                const u = update as any;
                if (u.usage) {
                    this._usageReported = true;
                    await this._callback.onUsage?.({
                        input_tokens: u.usage.inputTokens ?? 0,
                        output_tokens: u.usage.outputTokens ?? 0,
                        total_tokens: (u.usage.inputTokens ?? 0) + (u.usage.outputTokens ?? 0),
                    });
                }
                break;
            }
        }
    }

    // ── utilities ────────────────────────────────────────────────────────

    private async flushThinkText(): Promise<void> {
        const pending = this._text.trim();
        if (!pending) return;
        await this.saverService.pushThinkMessage(this._thinkId, { role: MessageRole.AI, content: pending });
        this._text = "";
    }

    protected formatHistory(messages: ChatMessage[]): string {
        const items: string[] = [];
        for (const msg of messages) {
            const parts: string[] = [];
            if (typeof msg.content === "string") {
                if (msg.content.trim()) parts.push(msg.content.trim());
            } else if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    if (block.type === "text" && block.text?.trim()) parts.push(block.text.trim());
                    else if (block.type === "image_url" || block.type === "image") parts.push("<image />");
                }
            }
            if (!parts.length) continue;
            const role = msg.role === MessageRole.Human ? "user"
                       : msg.role === MessageRole.AI ? "assistant"
                       : msg.role;
            items.push(`<history role="${role}">${parts.join("\n")}</history>`);
        }
        return `<historys>\n${items.join("\n")}\n</historys>`;
    }

    protected toContentBlocks(query: MessageContent): schema.ContentBlock[] {
        if (typeof query === "string") return [{ type: "text", text: query }];
        return (query as Array<{ type: string; text?: string; [k: string]: any }>).map(block => {
            if (block.type === "text") return { type: "text" as const, text: block.text ?? "" };
            if (block.type === "image_url" || block.type === "image") {
                return { type: "image" as const, data: block.image_url?.url ?? block.data ?? "", mimeType: block.mimeType ?? "image/png" };
            }
            return { type: "text" as const, text: JSON.stringify(block) };
        });
    }
}
