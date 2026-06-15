import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import { type StructuredToolInterface } from '@langchain/core/tools';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    INoteService, INoteDatabase,
    NoteService,
    IEmbeddingService,
    IAgentSaverService,
    T_NoteSystemPromptTemplate,
    T_NoteToolDescs,
    T_NoteCachePath,
    IWikiService, IWikiDatabase,
    WikiService,
    T_WikiSystemPromptTemplate,
    T_WikiToolDescs,
    T_WikiCachePath,
    IMemoryService,
    IAgendaService,
    T_ChannelSessionId,
    TimeUtils,
    type MessageContent,
} from "scorpio.ai";
import { loadPrompt } from "../Core/PromptLoader";
import { config } from "../Core/Config";
import { loadWorkspaceContext } from "../Core/WorkspaceContext";

import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../Session/SessionManager";
import { NoteDatabaseManager } from "./NoteDatabaseManager";
import { WikiDatabaseManager } from "./WikiDatabaseManager";
import { SaverPool } from "./SaverPool";
import { agendaServicePool } from "../Agenda";
import { memoryServicePool } from "../Memory/MemoryServicePool";

export interface AgentRunOptions {
    /** 用户输入的消息 */
    query: MessageContent;
    /** Agent 运行期间的消息回调（流式输出、工具调用确认等） */
    callbacks: IAgentCallback;
    /** 要运行的 Agent 配置 ID */
    agentId: string;
    /** 历史记录存储器配置 ID */
    saverId: string;
    /** 会话唯一标识，同时用作 saver threadId 和 session 管理 key */
    threadId: string;
    /** 注入 environment 块的额外信息（用户信息等特定渠道独有字段） */
    extraInfo: string;
    /** 笔记服务配置 ID 列表，不传则不启用笔记 */
    notes?: string[];
    /** Wiki 知识库配置 ID 列表 */
    wikis?: string[];
    /** Agent 文件操作根目录，不传则默认为 assets/{threadId} */
    workPath?: string;
    /** 关闭工作目录上下文文件（SBOT.md / AGENTS.md 等）的自动注入 */
    disableWorkspaceContext?: boolean;
    /** 关闭工作目录 .skills/ 子目录下 skill 的自动导入 */
    disableWorkspaceSkills?: boolean;
    /** 动态注册到 Agent 的工具列表 */
    agentTools?: StructuredToolInterface[];
    /** 归属会话 DB 主键（channel_session.id） */
    dbSessionId: string;
    /** memoryProfiles 中的 UUID；空表示不启用 memory */
    memoryId?: string | null;
    /** agendaProfiles 中的 UUID；空表示不启用 agenda */
    agendaId?: string | null;
}

export class AgentRunner {
    static async run(options: AgentRunOptions): Promise<void> {
        const { query, callbacks, agentId, saverId, threadId, dbSessionId, extraInfo, notes, wikis, agentTools } = options;
        if (!agentId.trim())   throw new Error("agent not specified");
        if (!saverId.trim())   throw new Error("saver not specified");
        if (!threadId.trim())  throw new Error("threadId not specified");

        const signal = sessionManager.getOrCreate(threadId).signal;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = config.getConfigPath('assets', true);
        const httpUrl = config.getHttpUrl();
        const workPath = options.workPath ?? `${assetsDir}/${threadId}`;
        if (!existsSync(workPath)) mkdirSync(workPath, { recursive: true });

        /** 静态 system prompts（可缓存）：instruction → environment */
        const extraPrompts: string[] = [
            loadPrompt('system/instruction.txt'),
            loadPrompt('system/environment.txt', {
                timezone,
                os: `${os.type()} ${os.release()} (${os.platform()})`,
                assetsDir,
                httpUrl,
                workPath,
            }),
        ];

        /** 动态 system prompts（每次请求变化，不可缓存） */
        const dynamicPrompts: string[] = [
            AgentRunner.createCurrentTimePrompt(timezone),
            ...(extraInfo?.trim() ? [extraInfo] : []),
        ];

        // 目录级上下文自动发现（SBOT.md / AGENTS.md 等），可由 profile/channel 配置关闭
        if (!options.disableWorkspaceContext) {
            const contextFiles = loadWorkspaceContext(workPath, config.settings.contextFileNames);
            if (contextFiles.length > 0) {
                const contextContent = contextFiles
                    .map(c => `<workspace-context source="${c.path}">\n${c.content}\n</workspace-context>`)
                    .join('\n');
                dynamicPrompts.push(contextContent);
            }
        }

        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        // SingleAgentService 把它传给 AgendaToolProvider 作为新 trigger 的 channelHint，
        // 也作为 extractFromConversation push pending job 时的 channelSessionId。
        const channelSessionId = parseInt(dbSessionId, 10) || 0;
        container.registerInstance(T_ChannelSessionId, channelSessionId);
        await AgentRunner.registerNoteServices(container, notes ?? []);
        await AgentRunner.registerWikiServices(container, wikis ?? []);
        const memoryService = AgentRunner.registerMemoryService(container, options.memoryId);
        const agendaService = AgentRunner.registerAgendaService(container, options.agendaId);

        let agent: Awaited<ReturnType<typeof AgentFactory.create>> | undefined;
        let saverHandle: Awaited<ReturnType<ReturnType<typeof SaverPool.getInstance>['acquire']>> | undefined;
        try {
            saverHandle = await SaverPool.getInstance().acquire(saverId, threadId);
            container.registerInstance(IAgentSaverService, saverHandle.saver);

            // Memory 系统由后台 MemoryWriter LLM 自主 CRUD，不需要显式记忆工具。
            const finalAgentTools: StructuredToolInterface[] = [...(agentTools ?? [])];

            agent = await AgentFactory.create({
                agentId,
                container,
                extraPrompts,
                dynamicPrompts,
                agentTools: finalAgentTools,
                dbSessionId,
                workPath,
                disableWorkspaceSkills: options.disableWorkspaceSkills,
            });
            await agent.stream(query, callbacks, signal);
        } finally {
            await agent?.dispose();
            memoryService?.release();
            agendaService?.release();
            await saverHandle?.release();
        }
    }

    private static createCurrentTimePrompt(timezone: string): string {
        return [
            '<current-time>',
            `Current local time: ${TimeUtils.formatLocalDateTime(timezone)}`,
            '</current-time>',
        ].join('\n');
    }

    static async createNoteService(noteId: string): Promise<INoteService> {
        const service = await AgentRunner.buildNoteService(noteId);
        if (!service) throw new Error(`Note config "${noteId}" not found or missing embedding`);
        return service;
    }

    private static async buildNoteService(noteId: string, loggerService?: LoggerService): Promise<INoteService | null> {
        const noteConfig = config.getNote(noteId);
        if (!noteConfig) return null;

        // embedding 可选：没配则 NoteService 退化为 BM25 + time decay + access。
        const embedding = noteConfig.embedding
            ? config.getEmbeddingService(noteConfig.embedding, true)
            : undefined;

        const sub = new ServiceContainer();
        if (loggerService) sub.registerInstance(ILoggerService, loggerService);
        const dbPath = config.getNoteDBPath(noteId);
        sub.registerInstance(INoteDatabase, NoteDatabaseManager.getInstance().acquire(dbPath));

        const args: Record<string | symbol, any> = {
            [T_NoteCachePath]: config.getNoteCachePath(noteId),
            [T_NoteSystemPromptTemplate]: loadPrompt('note/system.txt'),
            [T_NoteToolDescs]: { search: loadPrompt('tools/note/search.txt') },
        };
        if (embedding) args[IEmbeddingService] = embedding;

        sub.registerWithArgs(INoteService, NoteService, args);
        return sub.resolve<INoteService>(INoteService);
    }

    private static async registerNoteServices(
        container: ServiceContainer,
        notes: string[],
    ): Promise<void> {
        const loggerService = container.isRegistered(ILoggerService) ? container.resolve<LoggerService>(ILoggerService) : undefined
        const results = await Promise.all(notes.map(noteId => AgentRunner.buildNoteService(noteId, loggerService)));
        const services = results.filter((s): s is INoteService => s !== null);
        if (services.length > 0) {
            container.registerInstance(INoteService, services);
        }
    }

    static async createWikiService(wikiId: string): Promise<IWikiService> {
        const service = await AgentRunner.buildWikiService(wikiId);
        if (!service) throw new Error(`Wiki config "${wikiId}" not found`);
        return service;
    }

    private static async buildWikiService(wikiId: string): Promise<IWikiService | null> {
        const wikiConfig = config.getWiki(wikiId);
        if (!wikiConfig) return null;

        // embedding 可选：没配则 HybridSearcher 退化为 BM25-only。
        const embedding = wikiConfig.embedding
            ? config.getEmbeddingService(wikiConfig.embedding, true)
            : undefined;

        const sub = new ServiceContainer();
        const wikiDir = config.getWikiDBPath(wikiId);
        sub.registerInstance(IWikiDatabase, WikiDatabaseManager.getInstance().acquire(wikiDir));

        const args: Record<string | symbol, any> = {
            [T_WikiCachePath]: wikiDir,
            [T_WikiSystemPromptTemplate]: loadPrompt('wiki/system.txt'),
            [T_WikiToolDescs]: {
                search: loadPrompt('tools/wiki/search.txt'),
                read: loadPrompt('tools/wiki/read.txt'),
            },
        };
        if (embedding) args[IEmbeddingService] = embedding;

        sub.registerWithArgs(IWikiService, WikiService, args);
        return sub.resolve<IWikiService>(IWikiService);
    }

    private static async registerWikiServices(
        container: ServiceContainer,
        wikis: string[],
    ): Promise<void> {
        if (wikis.length === 0) return;
        const results = await Promise.all(wikis.map(wikiId => AgentRunner.buildWikiService(wikiId)));
        const services = results.filter((s): s is IWikiService => s !== null);
        if (services.length > 0) {
            container.registerInstance(IWikiService, services);
        }
    }

    /**
     * Memory（skill 风格）系统注册。命中 memoryProfiles 才注册；否则不启用记忆。
     * 返回 acquire 到的 service 引用；caller（run finally）负责调 service.release()
     * 来减 refCount。
     */
    private static registerMemoryService(
        container: ServiceContainer,
        memoryId: string | null | undefined,
    ): IMemoryService | null {
        if (!memoryId) return null;
        const profileConfig = config.getMemoryProfile(memoryId);
        if (!profileConfig?.enabled) return null;
        const service = memoryServicePool.acquire(memoryId);
        if (service) container.registerInstance(IMemoryService, service);
        return service;
    }

    /**
     * Agenda 系统注册（pool 单例 + refCount）。命中 agendaProfile 才注册；否则不启用 agenda。
     * 返回 acquire 到的 service 引用；caller（run finally）负责调 service.release()
     * 来减 refCount。channelSessionId 不进 service 构造器，由 SingleAgentService 通过
     * T_ChannelSessionId 注入到 agenda tool / extractFromConversation 调用点。
     */
    private static registerAgendaService(
        container: ServiceContainer,
        agendaId: string | null | undefined,
    ): IAgendaService | null {
        if (!agendaId) return null;
        const profileConfig = config.getAgendaProfile(agendaId);
        if (!profileConfig?.enabled) return null;
        const service = agendaServicePool.acquire(agendaId);
        if (service) container.registerInstance(IAgendaService, service);
        return service;
    }
}
1
