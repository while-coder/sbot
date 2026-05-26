import { ChildProcess, spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
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

const ACP_INIT_TIMEOUT_MS = 30_000;
const ACP_CLOSE_SESSION_TIMEOUT_MS = 5_000;

interface ACPStreamState {
    callback: IAgentCallback;
    text: string;
    thinkId: string;
    usageReported: boolean;
}

export abstract class ACPAgentServiceBase extends AgentServiceBase {
    protected command: string;
    protected args: string[];
    protected env: Record<string, string>;
    protected workPath: string;

    protected childProcess: ChildProcess | null = null;
    protected connection: ClientSideConnection | null = null;
    protected sessionId: string | null = null;
    protected initialized = false;

    private readonly activeStreams = new Map<string, ACPStreamState>();

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
        if (workPath && !existsSync(workPath)) {
            mkdirSync(workPath, { recursive: true });
        }
    }

    // ── stream ───────────────────────────────────────────────────────────

    override async stream(query: MessageContent, callback: IAgentCallback, signal?: AbortSignal): Promise<ChatMessage[]> {
        if (signal?.aborted) throw new AgentCancelledError();
        await this.ensureReady();

        const sessionId = this.sessionId!;
        if (this.activeStreams.has(sessionId)) {
            throw new Error(`ACP session ${sessionId} is already processing a prompt`);
        }

        const prompt = await this.preparePrompt(query);
        await this.saverService.pushMessage({ role: MessageRole.Human, content: query });

        const state: ACPStreamState = {
            callback,
            text: "",
            thinkId: uuidv4(),
            usageReported: false,
        };
        this.activeStreams.set(sessionId, state);

        const onCancel = () => {
            if (this.connection) this.connection.cancel({ sessionId });
        };
        signal?.addEventListener("abort", onCancel, { once: true });

        let promptCompleted = false;
        try {
            const response = await this.connection!.prompt({ sessionId, prompt });
            promptCompleted = true;
            this.onPromptSuccess();
            return await this.collectResponse(response, state);
        } catch (e) {
            if (!promptCompleted) this.onStreamError(e);
            await this.recordException(e, { thinkId: state.thinkId });
            throw e;
        } finally {
            signal?.removeEventListener("abort", onCancel);
            this.activeStreams.delete(sessionId);
            await this.onStreamFinally();
        }
    }

    protected onStreamError(_e: unknown): void {}
    protected onPromptSuccess(): void {}
    protected async onStreamFinally(): Promise<void> {}

    // ── dispose ──────────────────────────────────────────────────────────

    async forceDispose() {
        await this.closeCurrentSession();
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

        const childProcess = spawn(this.command, this.args, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: this.workPath || undefined,
            env: { ...process.env, ...this.env },
            shell: process.platform === "win32",
            windowsHide: true,
        });
        this.childProcess = childProcess;

        childProcess.stderr?.on("data", (chunk: Buffer) => {
            this.logger?.debug(`[ACP stderr] ${chunk.toString().trim()}`);
        });

        childProcess.on("exit", (code) => {
            this.logger?.info(`[ACP] process exited with code ${code}`);
            this.connection = null;
            this.initialized = false;
            this.sessionId = null;
            this.onProcessExit(code);
        });

        const stream = ndJsonStream(
            Writable.toWeb(childProcess.stdin!) as WritableStream<Uint8Array>,
            Readable.toWeb(childProcess.stdout!) as ReadableStream<Uint8Array>,
        );

        this.connection = new ClientSideConnection(
            () => ({
                requestPermission: (p: schema.RequestPermissionRequest) => this.handlePermission(p),
                sessionUpdate: (p: schema.SessionNotification) => this.handleSessionUpdate(p),
            }),
            stream,
        );

        let rejectStartup!: (error: Error) => void;
        const startupError = new Promise<never>((_, reject) => { rejectStartup = reject; });
        const onStartupError = (error: Error) => rejectStartup(error);
        childProcess.once("error", onStartupError);

        try {
            await this.withTimeout(
                Promise.race([
                    this.connection.initialize({
                        protocolVersion: 1,
                        clientCapabilities: {},
                        clientInfo: { name: "sbot", version: "1.0.0" },
                    }),
                    startupError,
                ]),
                ACP_INIT_TIMEOUT_MS,
                `ACP initialize timed out after ${ACP_INIT_TIMEOUT_MS}ms`,
            );
            this.initialized = true;
        } catch (e) {
            childProcess.kill();
            this.childProcess = null;
            this.connection = null;
            this.initialized = false;
            this.sessionId = null;
            throw e;
        } finally {
            childProcess.off("error", onStartupError);
        }
    }

    // ── prompt / response helpers ────────────────────────────────────────

    protected abstract preparePrompt(query: MessageContent): Promise<schema.ContentBlock[]>;

    protected async buildPrompt(query: MessageContent, includeHistory: boolean): Promise<schema.ContentBlock[]> {
        const blocks: schema.ContentBlock[] = [];
        if (includeHistory) {
            const history = await this.saverService.getMessages();
            if (history.length > 0) blocks.push({ type: "text", text: this.formatHistory(history) });
        }
        blocks.push(...this.toContentBlocks(query));
        return blocks;
    }

    protected async closeCurrentSession(): Promise<void> {
        const sessionId = this.sessionId;
        if (!sessionId || !this.connection) return;

        await this.withTimeout(
            this.connection.closeSession({ sessionId }),
            ACP_CLOSE_SESSION_TIMEOUT_MS,
            `ACP closeSession timed out after ${ACP_CLOSE_SESSION_TIMEOUT_MS}ms`,
        ).catch(e => {
            this.logger?.debug(`[ACP] closeSession ignored: ${e?.message ?? e}`);
        });
        if (this.sessionId === sessionId) this.sessionId = null;
    }

    private async collectResponse(response: { usage?: schema.Usage | null }, state: ACPStreamState): Promise<ChatMessage[]> {
        const messages: ChatMessage[] = [];
        if (state.text.trim()) {
            const msg: ChatMessage = {
                role: MessageRole.AI,
                content: state.text.trim(),
                additional_kwargs: { thinkId: state.thinkId },
            };
            messages.push(msg);
            await state.callback.onMessage?.(msg);
            await this.saverService.pushMessage(msg, { thinkId: state.thinkId });
        }
        if (response.usage && !state.usageReported) {
            await state.callback.onUsage?.(this.toTokenUsage(response.usage));
        }
        return messages;
    }

    // ── ACP session handlers ─────────────────────────────────────────────

    private async handlePermission(params: schema.RequestPermissionRequest) {
        const callback = this.activeStreams.get(params.sessionId)?.callback;
        if (!callback?.executeTool) {
            const opt = params.options.find(o => o.kind === "allow_once") ?? params.options[0];
            return { outcome: { outcome: "selected" as const, optionId: opt.optionId } };
        }

        const toolCall = {
            id: params.toolCall.toolCallId,
            name: params.toolCall.title ?? "unknown",
            args: (params.toolCall.rawInput as Record<string, any>) ?? {},
        };
        const approval = await callback.executeTool(toolCall);

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
        const state = this.activeStreams.get(params.sessionId);
        if (!state) return;

        const update = params.update;
        switch (update.sessionUpdate) {
            case "agent_message_chunk": {
                if (update.content.type === "text") {
                    state.text += (update.content as schema.TextContent).text ?? "";
                    await state.callback.onStreamMessage?.({ role: MessageRole.AI, content: state.text });
                }
                break;
            }
            case "tool_call": {
                await this.flushThinkText(state);
                await this.saverService.pushThinkMessage(state.thinkId, {
                    role: MessageRole.AI,
                    content: `[Tool: ${update.title}]`,
                    tool_calls: [{ id: update.toolCallId, name: update.title, args: (update.rawInput as Record<string, any>) ?? {} }],
                });
                await state.callback.onStreamMessage?.({ role: MessageRole.AI, content: `[Tool: ${update.title}]` });
                break;
            }
            case "tool_call_update": {
                if (update.status === "completed" || update.status === "failed") {
                    const raw = update.rawOutput;
                    const output = raw != null ? (typeof raw === "string" ? raw : JSON.stringify(raw)) : "";
                    await this.saverService.pushThinkMessage(state.thinkId, {
                        role: MessageRole.Tool,
                        tool_call_id: update.toolCallId,
                        content: output,
                        status: update.status === "failed" ? "error" : "success",
                    });
                    await state.callback.onStreamMessage?.({ role: MessageRole.Tool, content: output, tool_call_id: update.toolCallId });
                }
                break;
            }
            case "usage_update": {
                const usage = (update as { usage?: schema.Usage | null }).usage;
                if (usage) {
                    state.usageReported = true;
                    await state.callback.onUsage?.(this.toTokenUsage(usage));
                }
                break;
            }
        }
    }

    // ── utilities ────────────────────────────────────────────────────────

    private async flushThinkText(state: ACPStreamState): Promise<void> {
        const pending = state.text.trim();
        if (!pending) return;
        await this.saverService.pushThinkMessage(state.thinkId, { role: MessageRole.AI, content: pending });
        state.text = "";
    }

    private toTokenUsage(usage: schema.Usage) {
        const input_tokens = usage.inputTokens ?? 0;
        const output_tokens = usage.outputTokens ?? 0;
        return {
            input_tokens,
            output_tokens,
            total_tokens: input_tokens + output_tokens,
        };
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
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
                    else if (block.type === "image_url" || block.type === "image") parts.push("[image]");
                }
            }
            if (!parts.length) continue;
            const role = msg.role === MessageRole.Human ? "user"
                       : msg.role === MessageRole.AI ? "assistant"
                       : msg.role;
            items.push(`<history role="${role}">${parts.map(p => this.escapeXml(p)).join("\n")}</history>`);
        }
        return `<historys>\n${items.join("\n")}\n</historys>`;
    }

    protected toContentBlocks(query: MessageContent): schema.ContentBlock[] {
        if (typeof query === "string") return [{ type: "text", text: query }];
        return (query as Array<{ type: string; text?: string; [k: string]: any }>).map(block => {
            if (block.type === "text") return { type: "text" as const, text: block.text ?? "" };
            if (block.type === "image_url" || block.type === "image") return this.toImageContent(block);
            return { type: "text" as const, text: JSON.stringify(block) };
        });
    }

    private toImageContent(block: { type: string; text?: string; image_url?: { url?: string }; data?: string; mimeType?: string; [k: string]: any }): schema.ContentBlock {
        const source = block.image_url?.url ?? block.data ?? "";
        const dataUrl = source.match(/^data:([^;,]+)?;base64,(.*)$/);
        if (dataUrl) {
            return {
                type: "image",
                data: dataUrl[2],
                mimeType: block.mimeType ?? dataUrl[1] ?? "image/png",
            };
        }
        if (block.image_url?.url) {
            return {
                type: "image",
                data: "",
                uri: block.image_url.url,
                mimeType: block.mimeType ?? "image/png",
            };
        }
        return {
            type: "image",
            data: source,
            mimeType: block.mimeType ?? "image/png",
        };
    }

    private escapeXml(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }
}
