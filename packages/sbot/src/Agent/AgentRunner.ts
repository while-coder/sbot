import os from 'os';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { type StructuredToolInterface } from '@langchain/core/tools';
import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
    IEmbeddingService,
    IAgentSaverService,
    IWikiService, IWikiDatabase,
    WikiService,
    T_WikiSystemPromptTemplate,
    T_WikiToolDescs,
    T_WikiCachePath,
    IMemoryService,
    IAgentPlugin,
    T_ChannelSessionId,
    TimeUtils,
    type MessageContent,
    runtimeActivity,
} from "scorpio.ai";
import { AgendaPluginLease } from "agent.agenda";
import {
    INoteService,
    INoteDatabase,
    NoteService,
    NotePluginLease,
    T_NoteSystemPromptTemplate,
    T_NoteToolDescs,
    T_NoteCachePath,
    loadNotePrompt,
} from "agent.note";
import { loadPrompt } from "../Core/PromptLoader";
import { config } from "../Core/Config";
import { loadWorkspaceContext } from "../Core/WorkspaceContext";

import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../Session/SessionManager";
import { NoteDatabaseManager } from "./NoteDatabaseManager";
import { SaverPool } from "./SaverPool";
import { wikiPluginRegistry } from "../Wiki/WikiPluginRegistry";
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
    /** Channel 维度静态 prompt（输出介质/格式硬约束）；同一 channel type 每条消息一致，可走 system prompt 缓存 */
    channelPrompt?: string;
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
    /** 关闭工作目录 .mcp.json 中 MCP server 的自动导入 */
    disableWorkspaceMcp?: boolean;
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
        if (runtimeActivity.isStopping) {
            throw new Error("Service is shutting down; new agent tasks are not accepted");
        }
        return runtimeActivity.track(this.runInternal(options));
    }

    private static async runInternal(options: AgentRunOptions): Promise<void> {
        const { query, callbacks, agentId, saverId, threadId, dbSessionId, extraInfo, channelPrompt, notes, wikis, agentTools } = options;
        if (!agentId.trim())   throw new Error("agent not specified");
        if (!saverId.trim())   throw new Error("saver not specified");
        if (!threadId.trim())  throw new Error("threadId not specified");

        const signal = sessionManager.getOrCreate(threadId).signal;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = config.getConfigPath('assets', true);
        // assetsDir 整体挂在 /assets 下（见 HttpServer），所以其下任意文件的链接
        // = assetsUrl + '/' + 文件相对 assetsDir 的路径。这是唯一的链接推导规则：
        // 工作目录内外的产出同样适用，不再单独给工作目录一个 URL 前缀（两个前缀会让
        // Agent 拿工作目录的前缀去套工作目录外的文件，算出打不开的链接）。
        const assetsUrl = `${config.getHttpUrl()}/assets`;
        // Agent 始终需要一个实际工作目录。没有显式 workPath 时，文件产出仍按 thread
        // 隔离在 assets/threadId；Memory 则统一绑定固定的 ~/.sbot/workspace，避免普通
        // Web 对话没有 workspace scope、所有新记忆都被迫落进 global。
        const configuredWorkPath = options.workPath?.trim() || undefined;
        const existingWorkPath = configuredWorkPath && existsSync(configuredWorkPath)
            ? configuredWorkPath
            : undefined;
        const memoryWorkPath = existingWorkPath ?? config.getConfigPath('workspace', true);
        const workPath = existingWorkPath ?? path.join(assetsDir, threadId);
        if (!existsSync(workPath)) mkdirSync(workPath, { recursive: true });

        /** 静态 system prompts（可缓存）：instruction → environment → channel */
        const extraPrompts: string[] = [
            loadPrompt('system/instruction.txt'),
            loadPrompt('system/environment.txt', {
                timezone,
                os: `${os.type()} ${os.release()} (${os.platform()})`,
                assetsDir,
                assetsUrl,
                workPath,
            }),
            ...(channelPrompt?.trim() ? [channelPrompt] : []),
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
        // SingleAgentService 将它放入 AgentPluginContext，供需要会话归属的插件使用。
        const channelSessionId = parseInt(dbSessionId, 10) || 0;
        container.registerInstance(T_ChannelSessionId, channelSessionId);

        let noteLease: NotePluginLease | null = null;
        let memoryService: IMemoryService | null = null;
        let agendaLease: AgendaPluginLease | null = null;
        let agent: Awaited<ReturnType<typeof AgentFactory.create>> | undefined;
        let saverHandle: Awaited<ReturnType<ReturnType<typeof SaverPool.getInstance>['acquire']>> | undefined;
        try {
            noteLease = await AgentRunner.registerNotePlugin(container, notes ?? []);
            await AgentRunner.registerWikiServices(container, wikis ?? []);
            memoryService = await AgentRunner.registerMemoryService(container, options.memoryId, memoryWorkPath);
            agendaLease = AgentRunner.registerAgendaPlugin(container, options.agendaId);

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
                disableWorkspaceMcp: options.disableWorkspaceMcp,
            });
            await agent.stream(query, callbacks, signal);
        } finally {
            await agent?.dispose();
            await noteLease?.release();
            memoryService?.release();
            agendaLease?.release();
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
        const promptOverrides = config.getConfigPath('prompts', true);
        sub.registerInstance(INoteDatabase, NoteDatabaseManager.getInstance().acquire(dbPath));

        const args: Record<string | symbol, any> = {
            [T_NoteCachePath]: config.getNoteCachePath(noteId),
            [T_NoteSystemPromptTemplate]: loadNotePrompt('note/system.txt', promptOverrides),
            [T_NoteToolDescs]: { search: loadNotePrompt('tools/note/search.txt', promptOverrides) },
        };
        if (embedding) args[IEmbeddingService] = embedding;

        sub.registerWithArgs(INoteService, NoteService, args);
        return sub.resolve<INoteService>(INoteService);
    }

    /**
     * 将所有 Note 数据源聚合成一个 Agent capability plugin。
     * 返回的 lease 持有数据源；子 Agent 只继承插件引用，不获得释放权。
     */
    private static async registerNotePlugin(
        container: ServiceContainer,
        notes: string[],
    ): Promise<NotePluginLease | null> {
        const loggerService = container.isRegistered(ILoggerService) ? container.resolve<LoggerService>(ILoggerService) : undefined
        const results = await Promise.all(notes.map(noteId => AgentRunner.buildNoteService(noteId, loggerService)));
        const services = results.filter((s): s is INoteService => s !== null);
        if (services.length === 0) return null;
        const lease = new NotePluginLease(services);
        AgentRunner.registerAgentPlugin(container, lease.plugin);
        return lease;
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

        const wikiDir = config.getWikiDBPath(wikiId);
        const sourceType = wikiConfig.type ?? 'local';
        const plugin = wikiPluginRegistry.get(sourceType);
        if (!plugin) {
            LoggerService.getLogger('AgentRunner').warn(`Unknown wiki source type "${sourceType}" for wiki "${wikiId}", skipping`);
            return null;
        }
        const db = await plugin.init({
            config: wikiConfig.config ?? {},
            logger: LoggerService.getLogger(`wiki:${plugin.type}`),
            cachePath: wikiDir,
            embedding,
        });

        const sub = new ServiceContainer();
        sub.registerInstance(IWikiDatabase, db);

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
    private static async registerMemoryService(
        container: ServiceContainer,
        memoryId: string | null | undefined,
        workPath: string,
    ): Promise<IMemoryService | null> {
        if (!memoryId) return null;
        const profileConfig = config.getMemoryProfile(memoryId);
        if (!profileConfig?.enabled) return null;
        const service = await memoryServicePool.acquire(memoryId, workPath);
        if (service) container.registerInstance(IMemoryService, service);
        return service;
    }

    /**
     * Agenda capability plugin 注册（pool 单例 + refCount）。命中启用的 profile 才注册。
     * lease 由 run finally 释放；Agent 只通过 IAgentPlugin 消费能力，不感知 AgendaService。
     */
    private static registerAgendaPlugin(
        container: ServiceContainer,
        agendaId: string | null | undefined,
    ): AgendaPluginLease | null {
        if (!agendaId) return null;
        const profileConfig = config.getAgendaProfile(agendaId);
        if (!profileConfig?.enabled) return null;
        const lease = new AgendaPluginLease(agendaServicePool.acquire(agendaId));
        AgentRunner.registerAgentPlugin(container, lease.plugin);
        return lease;
    }

    /** 追加一个 capability，保留本轮已经注册的其他插件。 */
    private static registerAgentPlugin(container: ServiceContainer, plugin: IAgentPlugin): void {
        const existing = container.isRegistered(IAgentPlugin)
            ? container.resolve<IAgentPlugin[]>(IAgentPlugin)
            : [];
        container.registerInstance(IAgentPlugin, [
            ...existing.filter(item => item.name !== plugin.name),
            plugin,
        ]);
    }
}
