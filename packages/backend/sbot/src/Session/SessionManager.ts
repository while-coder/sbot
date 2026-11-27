import "reflect-metadata";
import { ICommand, MessageType, MessageRole, MessageKind, type MessageContent, trimContent, isEmptyContent, runtimeActivity } from "scorpio.ai";
import { SessionManager, SessionService, ChannelMessageArgs, ChannelSessionHandler } from "channel.base";
import { type AgentTool } from "scorpio.ai";
import { WEB_CHANNEL_ID } from "@sbot/shared";
import { config } from "../Core/Config";
import { channelDataService, type EffectiveSession } from "./ChannelDataService";
import { getSessionName } from "../utils";
import { channelManager } from "../Channel/ChannelManager";
import { createProcessAIHandler } from "../Processing/createProcessAIHandler";
import { SaverPool } from "../Agent/SaverPool";
import { MiddlewarePipeline } from "../Middleware/MiddlewarePipeline";
import { intentFilterMiddleware } from "../Middleware/intentFilter";
import type { MessageContext } from "../Middleware/types";

import { getBuiltInCommands } from "./BuiltInCommands";

export interface ChannelRouteArgs extends ChannelMessageArgs {
    channelType: string;
    channelId: string;
    dbSessionId: number;
    mentionBot?: boolean;
    agentTools?: AgentTool[];
    onComplete?: (error?: any) => void;
    onSteeringRejected?: (message: string) => void;
}

type AcceptSteering = (query: MessageContent, onRejected: () => void) => boolean;

interface SessionSteering {
    dbSessionId: number;
    accept?: AcceptSteering;
    startup: { query: MessageContent; onRejected: () => void }[];
}

const processAIHandler = createProcessAIHandler();

// ── Per-session concrete class ──

class SbotSession extends SessionService {
    private manager: SbotSessionManager;
    private channel?: ChannelSessionHandler;
    private activeSteering?: SessionSteering;

    constructor(threadId: string, manager: SbotSessionManager) {
        super(threadId, config.getConfigPath(`profiles/${threadId}/settings.json`));
        this.manager = manager;
    }

    private getChannel(args: ChannelRouteArgs) {
        if (!this.channel) {
            this.channel = this.manager.createChannel(args.channelType, this, args.channelId);
        }
        return this.channel;
    }

    protected async onProcessStart(query: MessageContent, args: ChannelRouteArgs, messageType: MessageType): Promise<string | void> {
        if (messageType === MessageType.AI && args.channelId === WEB_CHANNEL_ID) {
            this.activeSteering = { dbSessionId: args.dbSessionId, startup: [] };
        }
        await this.getChannel(args).onProcessStart(query, args, messageType);
        const channelName = config.getChannel(args.channelId)?.name;
        const sessionName = await getSessionName(args.dbSessionId);
        return [args.channelType, channelName ?? args.channelId, sessionName].filter(Boolean).join('/');
    }

    protected async processAI(query: MessageContent, args: ChannelRouteArgs): Promise<void> {
        const active = this.activeSteering;
        await this.getChannel(args).processAI(query, {
            ...args,
            registerSteering: (accept: AcceptSteering) => {
                if (!active) return;
                active.accept = accept;
                for (const input of active.startup.splice(0)) {
                    if (!accept(input.query, input.onRejected)) input.onRejected();
                }
            },
        });
    }

    handleFollowUp(query: MessageContent, args: ChannelRouteArgs): boolean {
        if (args.channelId !== WEB_CHANNEL_ID || !this.isProcessingQueue) return false;
        const onRejected = () => args.onSteeringRejected?.('该消息未发送。当前运行无法接收引导，请在运行结束后重发。');
        const active = this.activeSteering;
        if (active?.dbSessionId !== args.dbSessionId || (typeof query === 'string' && query.startsWith('/'))) {
            onRejected();
        } else if (active.accept) {
            if (!active.accept(query, onRejected)) onRejected();
        } else {
            active.startup.push({ query, onRejected });
        }
        return true;
    }

    override async onReceiveMessage(query: MessageContent, args: ChannelRouteArgs): Promise<void> {
        if (!this.handleFollowUp(query, args)) await super.onReceiveMessage(query, args);
    }

    protected async onCommandResult(query: string, content: string, args: ChannelRouteArgs): Promise<void> {
        if (args.dbSessionId != null) {
            try {
                const handle = await SaverPool.getInstance().acquireByDBSessionId(args.dbSessionId);
                try {
                    await handle.saver.pushMessage({ role: MessageRole.Human, content: query }, { kind: MessageKind.Command });
                    await handle.saver.pushMessage({ role: MessageRole.AI, content }, { kind: MessageKind.Command });
                } finally {
                    await handle.release();
                }
            } catch {
                // saver 未配置或解析失败，跳过持久化（与原行为一致）
            }
        }
        await this.getChannel(args).onChatMessage(
            { role: MessageRole.AI, content },
            { ...args, messageKind: MessageKind.Command },
        );
    }

    protected async onProcessEnd(query: MessageContent, args: ChannelRouteArgs, messageType: MessageType, error?: any): Promise<void> {
        const active = this.activeSteering;
        this.activeSteering = undefined;
        for (const input of active?.startup ?? []) input.onRejected();
        await this.getChannel(args).onProcessEnd(query, args, messageType, error);
        if (args.onComplete) {
            args.onComplete(error);
        }
        if (this.messageQueue.length === 0) {
            this.manager.end(this.threadId);
        }
    }

    protected async getAllCommands(): Promise<ICommand[]> {
        return getBuiltInCommands();
    }

    async triggerAction(...args: any[]): Promise<void> {
        await this.channel?.onTriggerAction(...args);
    }

    async resolveSessionConfig(args: any): Promise<EffectiveSession | undefined> {
        if (args?.dbSessionId == null) return undefined;
        return await channelDataService.getEffective(args.dbSessionId);
    }
}

// ── Merge helpers ──

interface MergeBufferEntry {
    items: { query: MessageContent; args: ChannelRouteArgs }[];
    timer: ReturnType<typeof setTimeout>;
}

function mergeMessageContents(items: { query: MessageContent }[]): MessageContent {
    if (items.length === 1) return items[0].query;

    const parts: Array<string | { type: string; text?: string;[key: string]: any }> = [];
    for (const { query } of items) {
        if (typeof query === 'string') {
            parts.push(query);
        } else {
            for (const part of query) {
                parts.push(part);
            }
        }
    }

    // 相邻纯文本合并
    const merged: Array<string | { type: string; text?: string;[key: string]: any }> = [];
    for (const part of parts) {
        const prev = merged[merged.length - 1];
        if (typeof part === 'string') {
            if (typeof prev === 'string') {
                merged[merged.length - 1] = prev + '\n' + part;
            } else if (prev && typeof prev === 'object' && prev.type === 'text' && prev.text != null) {
                merged[merged.length - 1] = { ...prev, text: prev.text + '\n' + part };
            } else {
                merged.push(part);
            }
        } else if (part.type === 'text' && part.text != null) {
            if (typeof prev === 'string') {
                merged[merged.length - 1] = prev + '\n' + part.text;
            } else if (prev && typeof prev === 'object' && prev.type === 'text' && prev.text != null) {
                merged[merged.length - 1] = { ...prev, text: prev.text + '\n' + part.text };
            } else {
                merged.push(part);
            }
        } else {
            merged.push(part);
        }
    }

    if (merged.length === 1 && typeof merged[0] === 'string') return merged[0];
    return merged.map(p => typeof p === 'string' ? { type: 'text', text: p } : p);
}

// ── Session manager singleton ──

export class SbotSessionManager extends SessionManager {
    private mergeBuffers = new Map<string, MergeBufferEntry>();
    readonly messagePipeline = new MiddlewarePipeline<MessageContext>();

    constructor() {
        super();
        this.messagePipeline.use(intentFilterMiddleware);
    }

    protected createSession(threadId: string): SessionService {
        return new SbotSession(threadId, this);
    }

    createChannel(type: string, session: SessionService, channelId?: string): ChannelSessionHandler {
        const service = channelId ? channelManager.getService(channelId) : undefined;
        if (!service) {
            throw new Error(`Channel service "${channelId}" not found`);
        }
        const sessionHandler = service.createSessionHandler(session);
        sessionHandler.setProcessAIHandler(processAIHandler);
        return sessionHandler;
    }

    // thread id 在每次消息进入时按 dbSessionId 现查一次 profile.id —— 用户切换 profile 后立即生效
    // session 一定先经 doInitSession / channelDataService.ensureSession 创建并建好 auto profile，所以 profileId > 0 由调用链保证
    private async resolveThreadId(dbSessionId: number): Promise<string> {
        const session = await channelDataService.getSession(dbSessionId, true);
        return String(session!.profileId);
    }

    // ── Channel entry points ──

    async onReceiveChannelMessage(query: MessageContent, args: ChannelRouteArgs): Promise<void> {
        if (runtimeActivity.isStopping) return;
        query = trimContent(query);
        if (isEmptyContent(query)) return;

        const threadId = await this.resolveThreadId(args.dbSessionId);

        const active = this.getSession(threadId) as SbotSession | undefined;
        if (active?.handleFollowUp(query, args)) return;

        // 命令消息跳过意图过滤和消息合并，直接透传
        if (typeof query === 'string' && query.trimStart().startsWith('/')) {
            const session = this.getOrCreate(threadId);
            await session.onReceiveMessage(query, args);
            return;
        }

        // 消息合并：mergeWindow > 0 时，缓存消息并 debounce
        const channel = args.channelId ? config.getChannel(args.channelId) : undefined;
        const mergeWindow = channel?.mergeWindow;
        if (mergeWindow && mergeWindow > 0) {
            const existing = this.mergeBuffers.get(threadId);
            if (existing) {
                clearTimeout(existing.timer);
                existing.items.push({ query, args });
            } else {
                this.mergeBuffers.set(threadId, { items: [{ query, args }], timer: null! });
            }
            const entry = this.mergeBuffers.get(threadId)!;
            entry.timer = setTimeout(() => this.flushMergeBuffer(threadId), mergeWindow);
            return;
        }

        await this.dispatchToSession(threadId, query, args);
    }

    private async flushMergeBuffer(threadId: string): Promise<void> {
        const entry = this.mergeBuffers.get(threadId);
        if (!entry) return;
        this.mergeBuffers.delete(threadId);

        const mergedQuery = mergeMessageContents(entry.items);
        const lastArgs = entry.items[entry.items.length - 1].args;
        await this.dispatchToSession(threadId, mergedQuery, lastArgs);
    }

    private async dispatchToSession(threadId: string, query: MessageContent, args: ChannelRouteArgs): Promise<void> {
        if (runtimeActivity.isStopping) return;
        const ctx: MessageContext = { query, args, threadId, filtered: false };
        await this.messagePipeline.execute(ctx, async (c) => {
            if (c.filtered) return;
            const session = this.getOrCreate(c.threadId);
            await session.onReceiveMessage(c.query, c.args);
        });
    }

    // ── Trigger action routing ──

    async onTriggerChannelAction(dbSessionId: number, ...args: any[]): Promise<void> {
        const threadId = await this.resolveThreadId(dbSessionId);
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(...args);
    }
}

export const sessionManager = new SbotSessionManager();
