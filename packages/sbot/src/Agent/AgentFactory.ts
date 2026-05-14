import {
    AgentServiceBase, SingleAgentService, GenerativeAgentService,
    TransientACPAgentService, PersistentACPAgentService, T_ACPCommand, T_ACPArgs, T_ACPEnv, T_ACPWorkPath,
    IModelService,
    IAgentSaverService, AgentMemorySaver, ILoggerService,
    ConversationCompactor, IConversationCompactor, T_SummaryModelService, T_CompactPromptTemplate,
} from "scorpio.ai";
import {
    IAgentToolService, AgentToolService,
    ISkillService, SkillService,
    IInsightService, InsightService,
    ServiceContainer, T_StaticSystemPrompts, T_DynamicSystemPrompts,
    ReActAgentService, T_AgentSubNodes, T_CreateAgent, T_ThinkModelService,
    T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc,
    T_SkillSystemPromptTemplate, T_SkillToolReadDesc, T_SkillToolListDesc, T_SkillToolExecDesc,
    T_InsightToolCreateDesc, T_InsightToolPatchDesc, T_InsightToolDeleteDesc, T_InsightDir,
    T_ModelCallTimeout, T_MaxHistoryRounds,
    type CreateAgentFn,
} from "scorpio.ai";
import { type StructuredToolInterface } from "@langchain/core/tools";
import { createSchedulerTools } from "../Tools/Scheduler/index";
import { createTodoTools } from "../Tools/Todo/index";
import { createSessionSearchTool } from "../Tools/SessionSearch/index";
import { config, AgentMode, ACPSessionMode, InsightScope, ToolAgentEntry, SingleAgentEntry, ReactAgentEntry, GenerativeAgentEntry, ACPAgentEntry } from "../Core/Config";
import { loadPrompt } from "../Core/PromptLoader";
import { globalAgentToolService, BuiltinProvider } from "./GlobalAgentToolService";
import { globalSkillService, getSkillsDirsMap } from "./GlobalSkillService";
import { ACPAgentPool } from "./ACPAgentPool";


export interface AgentCreateOptions {
    /** 要创建的 Agent 配置 ID */
    agentId: string;
    /** 当前请求的 DI 容器 */
    container: ServiceContainer;
    /** 注入到 system prompt 的额外上下文片段（静态，可缓存） */
    extraPrompts: string[];
    /** 每次请求变化的动态 system prompt（如 currentTime），不可缓存 */
    dynamicPrompts?: string[];
    /** 归属会话 DB 主键（channel_session.id），用于绑定 scheduler/todo 工具 */
    dbSessionId: string;
    /** 动态注册到 Agent 的工具列表 */
    agentTools?: StructuredToolInterface[];
    /** Agent 文件操作根目录（ACP 模式作为 cwd 传给外部 agent） */
    workPath?: string;
}

/**
 * Agent 工厂
 * 根据 AgentEntry 配置创建对应的 Agent 服务
 */
export class AgentFactory {

    static async create(options: AgentCreateOptions): Promise<AgentServiceBase> {
        const { agentId, container, extraPrompts, dynamicPrompts, agentTools } = options;
        const agentEntry = config.getAgent(agentId);

        if (!container.isRegistered(IAgentSaverService)) container.registerSingleton(IAgentSaverService, AgentMemorySaver);
        const agentType = agentEntry.type || AgentMode.Single;

        if (agentType !== AgentMode.Generative && agentType !== AgentMode.ACP) {
            const toolEntry = agentEntry as ToolAgentEntry;
            await this.registerSkillService(container, agentId, toolEntry.skills);
            await this.registerToolService(container, agentId, options.dbSessionId, toolEntry.mcp, agentTools);
            if (toolEntry.insight.scope !== InsightScope.Disabled) {
                await this.registerInsightService(container, agentId, options.dbSessionId, toolEntry.insight.scope);
            }
        }

        if (agentType === AgentMode.ACP) {
            return this.createACP(container, agentEntry as ACPAgentEntry, options);
        }

        const systemPrompts = [...extraPrompts];
        const sp = (agentEntry as ToolAgentEntry | GenerativeAgentEntry).systemPrompt;
        if (sp) systemPrompts.push(sp);

        if (dynamicPrompts && dynamicPrompts.length > 0) {
            container.registerInstance(T_DynamicSystemPrompts, dynamicPrompts);
        }

        const createAgentFn: CreateAgentFn = (name, subContainer) =>
            AgentFactory.create({ agentId: name, container: subContainer, extraPrompts, dynamicPrompts, agentTools, dbSessionId: options.dbSessionId });

        switch (agentType) {
            case AgentMode.ReAct:
                return this.createReAct(container, agentEntry as ReactAgentEntry, systemPrompts, createAgentFn);

            case AgentMode.Generative:
                return this.createGenerative(container, agentEntry as GenerativeAgentEntry, systemPrompts);

            case AgentMode.Single:
            default:
                return this.createSingle(container, agentEntry as SingleAgentEntry, systemPrompts);
        }
    }

    private static async registerSkillService(
        container: ServiceContainer,
        agentName: string,
        skills?: string[] | '*',
    ): Promise<void> {
        container.registerWithArgs(ISkillService, SkillService, {
            [T_SkillSystemPromptTemplate]: loadPrompt('skills/system.txt'),
            [T_SkillToolReadDesc]: loadPrompt('skills/tool_read_skill_file.txt'),
            [T_SkillToolListDesc]: loadPrompt('skills/tool_list_skill_files.txt'),
            [T_SkillToolExecDesc]: loadPrompt('skills/tool_execute_skill_script.txt'),
        });
        const skillService = await container.resolve<SkillService>(ISkillService);
        if (skills === '*') {
            for (const dir of Object.values(getSkillsDirsMap())) {
                skillService.registerSkillsDir(dir);
            }
        } else if (skills && skills.length > 0) {
            const allGlobalSkills = globalSkillService.getAllSkills();
            for (const name of skills) {
                const skill = allGlobalSkills.find(s => s.name === name);
                if (skill) skillService.registerSingleSkillDir(skill.path);
            }
        }
        skillService.registerSkillsDir(config.getAgentSkillsPath(agentName));
    }

    private static async registerInsightService(
        container: ServiceContainer,
        agentName: string,
        dbSessionId: string,
        scope: InsightScope,
    ): Promise<void> {
        const insightDir = scope === InsightScope.Session
            ? config.getSessionInsightsPath(dbSessionId)
            : config.getAgentInsightsPath(agentName);

        container.registerWithArgs(IInsightService, InsightService, {
            [T_InsightDir]: insightDir,
            [T_InsightToolCreateDesc]: loadPrompt('insight/tool_create.txt'),
            [T_InsightToolPatchDesc]: loadPrompt('insight/tool_patch.txt'),
            [T_InsightToolDeleteDesc]: loadPrompt('insight/tool_delete.txt'),
        });

        const skillService = await container.resolve<SkillService>(ISkillService);
        skillService.registerSkillsDir(insightDir);
    }

    private static readonly SESSION_TOOL_CREATORS: Record<string, (dbSessionId: string) => Promise<StructuredToolInterface[]>> = {
        [BuiltinProvider.Scheduler]: (id) => Promise.resolve(createSchedulerTools(id)),
        [BuiltinProvider.Todo]: (id) => Promise.resolve(createTodoTools(id)),
    };

    private static async registerToolService(
        container: ServiceContainer,
        agentName: string,
        dbSessionId: string,
        mcp?: string[] | '*',
        agentTools?: StructuredToolInterface[],
    ): Promise<void> {
        container.registerSingleton(IAgentToolService, AgentToolService);
        const toolService = await container.resolve<AgentToolService>(IAgentToolService);

        const sessionNames = new Set(Object.keys(this.SESSION_TOOL_CREATORS));

        if (mcp === '*') {
            for (const [name, creator] of Object.entries(this.SESSION_TOOL_CREATORS)) {
                toolService.registerToolFactory(name, () => creator(dbSessionId));
            }
            toolService.registerToolFactory('__global_mcp__', () => globalAgentToolService.getAllTools());
        } else if (mcp && mcp.length > 0) {
            for (const name of mcp) {
                const creator = this.SESSION_TOOL_CREATORS[name];
                if (creator) {
                    toolService.registerToolFactory(name, () => creator(dbSessionId));
                }
            }
            const globalNames = mcp.filter(n => !sessionNames.has(n));
            if (globalNames.length > 0) {
                toolService.registerToolFactory('__global_mcp__', () => globalAgentToolService.getToolsFrom(globalNames));
            }
        }

        if (agentTools?.length) {
            toolService.registerToolFactory('__channel__', () => Promise.resolve(agentTools));
        }

        // 跨会话搜索工具（需 saver 支持 FTS5）
        toolService.registerToolFactory('__session_search__', async () => {
            if (!container.isRegistered(IAgentSaverService)) return [];
            const saver = await container.resolve<IAgentSaverService>(IAgentSaverService);
            if (!('searchMessages' in saver)) return [];
            return [createSessionSearchTool(saver)];
        });

        toolService.registerMcpServers(config.getAgentMcpServers(agentName));
    }

    /**
     * 创建 Single Agent
     */
    private static async createSingle(
        container: ServiceContainer,
        entry: SingleAgentEntry,
        systemPrompts: string[],
    ): Promise<AgentServiceBase> {

        if (entry.compactModel) {
            container.registerWithArgs(IConversationCompactor, ConversationCompactor, {
                [T_SummaryModelService]: await config.getModelService(entry.compactModel, true),
                ...(entry.compactPrompt && { [T_CompactPromptTemplate]: entry.compactPrompt }),
            });
        }

        container.registerWithArgs(SingleAgentService, {
            [IModelService]: await config.getModelService(entry.model, true),
            [T_StaticSystemPrompts]: systemPrompts,
            ...(entry.modelCallTimeout != null && { [T_ModelCallTimeout]: entry.modelCallTimeout * 1000 }),
        });
        return container.resolve(SingleAgentService);
    }

    /**
     * 创建 Generative Agent（图片/音频等纯生成式模型，无工具循环）
     */
    private static async createGenerative(
        container: ServiceContainer,
        entry: GenerativeAgentEntry,
        systemPrompts: string[],
    ): Promise<AgentServiceBase> {
        const args: Record<symbol, any> = {
            [IModelService]: await config.getModelService(entry.model, true),
            [T_StaticSystemPrompts]: systemPrompts,
        };
        if (entry.maxHistoryRounds != null) {
            args[T_MaxHistoryRounds] = entry.maxHistoryRounds;
        }
        container.registerWithArgs(GenerativeAgentService, args);
        return container.resolve(GenerativeAgentService);
    }

    /**
     * 创建 ReAct Agent
     */
    private static async createReAct(
        container: ServiceContainer,
        entry: ReactAgentEntry,
        systemPrompts: string[],
        createAgentFn: CreateAgentFn,
    ): Promise<AgentServiceBase> {
        const agentSubNodes = entry.agents || [];
        if (agentSubNodes.length === 0) {
            throw new Error("ReAct mode: no sub-agents configured");
        }
        if (!entry.model) {
            throw new Error("ReAct mode: model not configured");
        }
        
        container.registerWithArgs(ReActAgentService, {
            [T_AgentSubNodes]: agentSubNodes,
            [T_CreateAgent]: createAgentFn,
            [T_ThinkModelService]: await config.getModelService(entry.model, true),
            [T_StaticSystemPrompts]: systemPrompts,
            [T_ReactSystemPromptTemplate]: loadPrompt('agent/react_system.txt'),
            [T_ReactSubNodePrompt]: loadPrompt('agent/react_subnode.txt'),
            [T_ReactTaskToolDesc]: loadPrompt('agent/react_task.txt'),
        });
        return container.resolve(ReActAgentService);
    }

    /**
     * 创建 ACP Agent（通过 ACP 协议委派给外部编码 Agent）
     */
    private static async createACP(
        container: ServiceContainer,
        entry: ACPAgentEntry,
        options: AgentCreateOptions,
    ): Promise<AgentServiceBase> {
        const workPath = options.workPath ?? process.cwd();
        const sessionMode = entry.sessionMode ?? ACPSessionMode.Persistent;
        const acpArgs = {
            [T_ACPCommand]: entry.command,
            [T_ACPArgs]: entry.args ?? [],
            [T_ACPWorkPath]: workPath,
            ...(entry.env && { [T_ACPEnv]: entry.env }),
        };

        if (sessionMode === ACPSessionMode.Persistent) {
            const pool = ACPAgentPool.getInstance();
            const key = `${options.agentId}:${options.dbSessionId}`;
            const agentName = entry.name ?? options.agentId;
            const configHash = JSON.stringify({ command: entry.command, args: entry.args ?? [], env: entry.env ?? {}, workPath });

            const cached = await pool.tryGet(key, configHash);
            if (cached) return cached;

            const sub = new ServiceContainer();
            if (container.isRegistered(ILoggerService))
                sub.registerInstance(ILoggerService, await container.resolve(ILoggerService));
            if (container.isRegistered(IAgentSaverService))
                sub.registerInstance(IAgentSaverService, await container.resolve(IAgentSaverService));
            sub.registerWithArgs(PersistentACPAgentService, acpArgs);
            const instance = await sub.resolve<PersistentACPAgentService>(PersistentACPAgentService);
            pool.put(key, instance, { agentId: options.agentId, agentName, dbSessionId: options.dbSessionId, configHash });
            return instance;
        }

        container.registerWithArgs(TransientACPAgentService, acpArgs);
        return container.resolve(TransientACPAgentService);
    }
}
