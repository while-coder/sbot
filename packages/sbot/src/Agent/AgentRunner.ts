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
    IModelService,
    IWikiService, IWikiDatabase,
    WikiService,
    T_WikiSystemPromptTemplate,
    T_WikiToolDescs,
    IInsightService, InsightService,
    IInsightExtractor, InsightExtractor,
    T_InsightDir,
    T_InsightExtractorSystemPrompt,
    T_InsightStaleDays, T_InsightArchiveDays, T_InsightSystemPromptTemplate,
    IAgendaService,
    IAgendaSyncExtractor,
    AgendaSyncExtractor,
    T_AgendaSyncSystemPrompt,
    type MessageContent,
} from "scorpio.ai";
import { loadPrompt } from "../Core/PromptLoader";
import { config, type AgendaConfig, type InsightConfig } from "../Core/Config";
import { loadWorkspaceContext } from "../Core/WorkspaceContext";

import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "../Core/LoggerService";
import { sessionManager } from "../Session/SessionManager";
import { NoteDatabaseManager } from "./NoteDatabaseManager";
import { WikiDatabaseManager } from "./WikiDatabaseManager";
import { SaverPool } from "./SaverPool";
import { AgendaService } from "../Agenda";

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
    /** Profile 级 Insight 配置 */
    insightConfig?: InsightConfig | null;
    /** Profile 级 Agenda 配置；disabled 时不注册 Agenda 工具和同步 */
    agendaConfig?: AgendaConfig | null;
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
        await AgentRunner.registerNoteServices(container, notes ?? []);
        await AgentRunner.registerWikiServices(container, wikis ?? []);
        await AgentRunner.registerInsightService(container, options.insightConfig, threadId);
        await AgentRunner.registerAgendaService(container, options.agendaConfig, threadId, dbSessionId);

        const saverHandle = await SaverPool.getInstance().acquire(saverId, threadId);
        container.registerInstance(IAgentSaverService, saverHandle.saver);

        const agent = await AgentFactory.create({
            agentId,
            container,
            extraPrompts,
            dynamicPrompts,
            agentTools,
            dbSessionId,
            workPath,
            disableWorkspaceSkills: options.disableWorkspaceSkills,
        });
        try {
            await agent.stream(query, callbacks, signal);
        } finally {
            await agent.dispose();
            await saverHandle.release();
        }
    }

    private static createCurrentTimePrompt(timezone: string): string {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(now);
        const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
        const localTime = `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')} (${value('weekday')}, ${timezone})`;

        return [
            '<current-time>',
            `Current local time: ${localTime}`,
            `Current UTC time: ${now.toISOString()}`,
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
        if (!noteConfig?.embedding) return null;

        const embedding = await config.getEmbeddingService(noteConfig.embedding, true);

        const sub = new ServiceContainer();
        if (loggerService) sub.registerInstance(ILoggerService, loggerService);
        const dbPath = config.getNoteDBPath(noteId);
        sub.registerInstance(INoteDatabase, NoteDatabaseManager.getInstance().acquire(dbPath));

        sub.registerWithArgs(INoteService, NoteService, {
            [IEmbeddingService]: embedding,
            [T_NoteSystemPromptTemplate]: loadPrompt('note/system.txt'),
            [T_NoteToolDescs]: { search: loadPrompt('tools/note/search.txt') },
        });

        return sub.resolve<INoteService>(INoteService);
    }

    private static async registerNoteServices(
        container: ServiceContainer,
        notes: string[],
    ): Promise<void> {
        const loggerService = container.isRegistered(ILoggerService) ? await container.resolve<LoggerService>(ILoggerService) : undefined
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

        const sub = new ServiceContainer();
        const wikiDir = config.getWikiDBPath(wikiId);
        sub.registerInstance(IWikiDatabase, WikiDatabaseManager.getInstance().acquire(wikiDir));

        const args: Record<string | symbol, any> = {
            [T_WikiSystemPromptTemplate]: loadPrompt('wiki/system.txt'),
            [T_WikiToolDescs]: {
                search: loadPrompt('tools/wiki/search.txt'),
                read: loadPrompt('tools/wiki/read.txt'),
            },
        };

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

    private static async registerInsightService(
        container: ServiceContainer,
        insightConfig: InsightConfig | null | undefined,
        threadId: string,
    ): Promise<void> {
        if (!insightConfig?.enabled) return;

        const insightDir = config.getProfileInsightsPath(threadId);

        const extractorModel = await config.getModelService(insightConfig.extractor, true);
        container.registerWithArgs(IInsightExtractor, InsightExtractor, {
            [IModelService]: extractorModel,
            [T_InsightExtractorSystemPrompt]: loadPrompt(insightConfig.extractorPromptFile ?? 'insight/extractor/default.txt'),
        });

        container.registerWithArgs(IInsightService, InsightService, {
            [T_InsightDir]: insightDir,
            [T_InsightSystemPromptTemplate]: loadPrompt('insight/system.txt'),
            [T_InsightStaleDays]: 30,
            [T_InsightArchiveDays]: 90,
        });
    }

    private static async registerAgendaService(
        container: ServiceContainer,
        agendaConfig: AgendaConfig | null | undefined,
        threadId: string,
        dbSessionId: string,
    ): Promise<void> {
        if (!agendaConfig?.enabled) return;

        const syncModelId = agendaConfig.syncModel;
        let extractor: IAgendaSyncExtractor | undefined;
        if (syncModelId) {
            const extractorModel = await config.getModelService(syncModelId, true);
            const sub = new ServiceContainer();
            if (container.isRegistered(ILoggerService)) {
                sub.registerInstance(ILoggerService, await container.resolve(ILoggerService));
            }
            sub.registerInstance(IModelService, extractorModel);
            sub.registerInstance(T_AgendaSyncSystemPrompt, loadPrompt(agendaConfig.syncPromptFile ?? 'agenda/sync/default.txt'));
            sub.registerSingleton(IAgendaSyncExtractor, AgendaSyncExtractor);
            extractor = await sub.resolve<IAgendaSyncExtractor>(IAgendaSyncExtractor);
        }

        const profileId = parseInt(threadId, 10);
        const channelSessionId = parseInt(dbSessionId, 10);
        if (!profileId || !channelSessionId) return;

        const service = new AgendaService(
            profileId,
            channelSessionId,
            {
                create: loadPrompt('agenda/tools/create.txt'),
                list: loadPrompt('agenda/tools/list.txt'),
                update: loadPrompt('agenda/tools/update.txt'),
                complete: loadPrompt('agenda/tools/complete.txt'),
                cancel: loadPrompt('agenda/tools/cancel.txt'),
                skipNext: loadPrompt('agenda/tools/skip_next.txt'),
            },
            extractor,
        );
        container.registerInstance(IAgendaService, service);
    }
}
