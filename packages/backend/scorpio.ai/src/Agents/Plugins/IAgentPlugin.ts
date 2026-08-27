import { type AgentTool } from "scorpio.llm";
import type { ILogger } from "../../Logger";
import type { ChatMessage, IAgentSaverService } from "scorpio.saver";

/**
 * Agent 能力插件的运行上下文。每次 stream 构造一份，不跨轮复用。
 *
 * query 供 note 等检索插件构造查询，channelSessionId 供 agenda 等插件关联会话。
 */
export interface AgentPluginContext {
    /** 本轮用户输入的纯文本形式（多模态 content 已拍平），供检索类插件构造查询。 */
    readonly query: string;
    /** 本轮归属的 channel session db id，供需要会话归属的插件使用。 */
    readonly channelSessionId: number;
    /** 本轮历史存储器，插件可读完整对话与 metadata。 */
    readonly saver: IAgentSaverService;
    /** 以插件 name 派生的 logger。 */
    readonly logger?: ILogger;
}

/**
 * system prompt 的注入分区，与 system message 的两个 content block 一一对应。
 */
export enum AgentPluginPromptKind {
    /** 静态块：跨请求不变，可命中 prompt caching。取自 {@link IAgentPlugin.getStaticSystemPrompt}。 */
    Static = 'static',
    /** 动态块：每轮可变。取自 {@link IAgentPlugin.getDynamicSystemPrompt}。 */
    Dynamic = 'dynamic',
}

/**
 * 一轮对话结束时的结果快照，作为 {@link IAgentPlugin.onTurnCompleted} 的第一个参数。
 *
 * 只装本轮结果，不含运行上下文——ctx 作为独立的第二个参数传入，
 * 两者职责分开：turn 是「这一轮产出了什么」，ctx 是「这一轮在什么环境里跑」。
 */
export interface AgentTurn {
    /** 本轮完整对话：首条为 human 消息，其后是 agent 的全部输出（AI / tool 消息）。 */
    readonly conversation: ChatMessage[];
}

/**
 * Agent 能力插件：把一套子系统（system prompt + 工具 + turn 末尾副作用）打包成
 * 可插拔单元，注册进容器即生效，无需再改 SingleAgentService。
 *
 * 与 Wiki 数据源插件（`WikiPlugin`）、Channel 插件不是同一层概念——那两者是「某类
 * 数据源/渠道的具体实现」，本接口是「挂到 agent 生命周期上的扩展点」。
 *
 * **生命周期不在本接口内**：插件由注册方创建并负责释放（memory / agenda 那类走 pool +
 * refCount 的服务，由 acquire 方在 finally 里 release）。agent 只消费插件、不 dispose，
 * 否则 pool 化服务会被双重释放。
 *
 * 所有钩子均为可选：只出工具的插件只实现 getTools，只注入 prompt 的只实现 getDynamicSystemPrompt。
 * 单个钩子抛错由框架捕获并降级为日志告警，不会中断本轮请求。
 */
export interface IAgentPlugin {
    /** 唯一标识，用于日志定位。 */
    readonly name: string;

    /**
     * ReAct 派发子 agent 时是否随子容器下传。默认 false。
     *
     * 抽取类插件（memory / agenda 风格）应保持 false：子 agent 的 human 消息是编排者
     * 合成的 task 指令而非真实用户输入，参与抽取会污染数据。纯检索类（note / wiki 风格）
     * 置 true 让子 agent 也能用。
     */
    readonly inheritToSubAgent?: boolean;

    /**
     * 静态 system prompt：跨请求不变，拼进 system message 的第一个 content block，
     * 可命中 prompt caching。返回随请求变化的内容会让缓存持续失效——那种内容用
     * {@link getDynamicSystemPrompt}。返回 undefined / 空串表示本轮不注入。
     */
    getStaticSystemPrompt?(ctx: AgentPluginContext): Promise<string | undefined> | string | undefined;

    /**
     * 动态 system prompt：每轮可变（如按 query 检索出的片段），拼进第二个 content block。
     * 返回 undefined / 空串表示本轮不注入。
     */
    getDynamicSystemPrompt?(ctx: AgentPluginContext): Promise<string | undefined> | string | undefined;

    /**
     * 本轮暴露给模型的工具。插件工具排在框架自有工具之后：同名时框架工具胜出，
     * 模型 maxTools 截断也优先砍插件工具。
     */
    getTools?(ctx: AgentPluginContext): Promise<AgentTool[]> | AgentTool[];

    /**
     * 一轮对话结束后触发的副作用钩子（后台抽取、统计、清理等）。
     *
     * turn 是本轮产出的快照，ctx 是与其他钩子同一份的运行上下文。
     * fire-and-forget：框架不 await 返回的 promise，实现方应只做同步入队之类的轻量动作，
     * 重活自行放后台。同步抛错与 promise reject 都会被捕获并写日志。
     * 命名不用 extractFromConversation 是因为用途不限于抽取。
     */
    onTurnCompleted?(turn: AgentTurn, ctx: AgentPluginContext): void | Promise<void>;
}

/**
 * IAgentPlugin 的依赖注入 token。注册值为**插件数组**：
 * `container.registerInstance(IAgentPlugin, [pluginA, pluginB])`。
 */
export const IAgentPlugin = Symbol("IAgentPlugin");
