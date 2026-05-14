import "reflect-metadata";
import { ICommand, MessageType, type ChatMessage, type MessageContent, trimContent, isEmptyContent } from "scorpio.ai";
import { SessionManager, SessionService, ChannelMessageArgs, ChannelSessionHandler } from "channel.base";
import { type StructuredToolInterface } from "@langchain/core/tools";
import { WEB_CHANNEL_ID, WEB_CHANNEL_TYPE, type ChannelConfig } from "sbot.commons";
import { config } from "../Core/Config";
import { ChannelSessionRow, getChannelSession } from "../Core/Database";
import { channelManager } from "../Channel/ChannelManager";
import { createProcessAIHandler } from "../Processing/createProcessAIHandler";
import { classifyIntent } from "../Processing/classifyIntent";

import { getBuiltInCommands } from "./BuiltInCommands";
import { WebSocketSessionHandler } from "../Channel/web/WebSocketSessionHandler";

interface ChannelRouteArgs extends ChannelMessageArgs {
    channelType: string;
    channelId: string;
    dbSessionId: number;
    mentionBot?: boolean;
    silent?: boolean;
    agentTools?: StructuredToolInterface[];
    toolWhitelist?: string[];
    onMessage?: (msg: ChatMessage) => void;
    onComplete?: (error?: any) => void;
}

const processAIHandler = createProcessAIHandler();

// ── Per-session concrete class ──

class SbotSession extends SessionService {
    private manager: SbotSessionManager;
    private channel?: ChannelSessionHandler;

    constructor(threadId: string, manager: SbotSessionManager) {
        super(threadId, config.getConfigPath(`sessions/${threadId}/settings.json`));
        this.manager = manager;
    }

    private getChannel(args: ChannelRouteArgs) {
        if (!this.channel) {
            this.channel = this.manager.createChannel(args.channelType, this, args.channelId);
        }
        return this.channel;
    }

    private argsWithQueue(args: ChannelRouteArgs) {
        return { ...args, pendingMessages: this.messageQueue.map(m => m.query) };
    }

    protected async onProcessStart(query: MessageContent, args: ChannelRouteArgs, messageType: MessageType): Promise<string | void> {
        if (!args.silent) {
            await this.getChannel(args).onProcessStart(query, this.argsWithQueue(args), messageType);
        }
        const channelName = config.getChannel(args.channelId)?.name;
        return [args.channelType, channelName ?? args.channelId, this.threadId].filter(Boolean).join('/');
    }

    protected async processAI(query: MessageContent, args: ChannelRouteArgs): Promise<void> {
        await this.getChannel(args).processAI(query, args);
    }

    protected async onCommandResult(content: string, args: ChannelRouteArgs): Promise<void> {
        await this.getChannel(args).onCommandResult(content, args);
    }

    protected async onProcessEnd(query: MessageContent, args: ChannelRouteArgs, messageType: MessageType, error?: any): Promise<void> {
        if (!args.silent) {
            await this.getChannel(args).onProcessEnd(query, this.argsWithQueue(args), messageType, error);
        }
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

    async resolveSessionConfig(args: any): Promise<{ dbSession: ChannelSessionRow; channelConfig?: ChannelConfig } | undefined> {
        const dbSession = await getChannelSession(args?.dbSessionId);
        if (!dbSession) return undefined;
        return {
            dbSession,
            channelConfig: config.getChannel(dbSession.channelId),
        };
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

    constructor() {
        super();
    }

    protected createSession(threadId: string): SessionService {
        return new SbotSession(threadId, this);
    }

    createChannel(type: string, session: SessionService, channelId?: string): ChannelSessionHandler {
        if (channelId === WEB_CHANNEL_ID) {
            const sessionHandler = new WebSocketSessionHandler(session);
            sessionHandler.setProcessAIHandler(processAIHandler);
            return sessionHandler;
        } else {
            const service = channelId ? channelManager.getService(channelId) : undefined;
            if (!service) {
                throw new Error(`Channel service "${channelId}" not found`);
            }
            const sessionHandler = service.createSessionHandler(session);
            sessionHandler.setProcessAIHandler(processAIHandler);
            return sessionHandler;
        }
    }

    // ── Channel entry points ──

    async onReceiveChannelMessage(threadId: string, query: MessageContent, args: ChannelRouteArgs): Promise<void> {
        query = trimContent(query);
        if (isEmptyContent(query)) return;

        // 静默模式和命令消息跳过意图过滤和消息合并，直接透传
        if (args.silent || (typeof query === 'string' && query.trimStart().startsWith('/'))) {
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
        if (!await this.passIntentFilter(query, args, threadId)) return;
        const session = this.getOrCreate(threadId);
        await session.onReceiveMessage(query, args);
    }

    private async passIntentFilter(query: MessageContent, args: ChannelRouteArgs, threadId: string): Promise<boolean> {
        if (args?.mentionBot) return true;
        const dbSession = await getChannelSession(args?.dbSessionId);
        const channel = args.channelId ? config.getChannel(args.channelId) : undefined;
        const intentModel = dbSession?.intentModel != null ? dbSession.intentModel : channel?.intentModel;
        if (!intentModel) return true;
        const intentPrompt = dbSession?.intentPrompt != null ? dbSession.intentPrompt : (channel?.intentPrompt ?? null);
        const intentThreshold = dbSession?.intentThreshold != null ? dbSession.intentThreshold : (channel?.intentThreshold ?? 0.7);
        return classifyIntent(query, intentModel, intentPrompt, intentThreshold, threadId);
    }

    async onReceiveWebMessage(threadId: string, query: MessageContent, sessionId: string, dbSessionId: number): Promise<void> {
        query = trimContent(query);
        if (isEmptyContent(query)) return;
        const args: ChannelRouteArgs = {
            channelType: WEB_CHANNEL_TYPE,
            channelId: WEB_CHANNEL_ID,
            dbSessionId,
            sessionId,
        };
        await this.onReceiveChannelMessage(threadId, query, args);
    }

    // ── Trigger action routing ──

    async onChannelTriggerAction(threadId: string, args: any): Promise<void> {
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(args);
    }

    async onWebTriggerAction(threadId: string, type: string, msg: Record<string, any>): Promise<void> {
        const session = this.getSession(threadId) as SbotSession | undefined;
        await session?.triggerAction(type, msg);
    }
}

export const sessionManager = new SbotSessionManager();
