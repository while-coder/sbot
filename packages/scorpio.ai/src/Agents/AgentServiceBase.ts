import { ServiceContainer } from "scorpio.di";
import { INoteService } from "../Note";
import { IWikiService } from "../Wiki";
import { IAgentSaverService, AgentMemorySaver, ChatMessage, ChatToolCall, MessageKind, MessageRole, type MessageContent, type ContentPart, type TokenUsage } from "../Saver";
import { ILoggerService, ILogger } from "../Logger";
import { resizeImageIfNeeded, detectImageMimeType } from "../Utils/contentUtils";


export const DEFAULT_MAX_HISTORY_TOKENS = 150_000;
/** @deprecated Use DEFAULT_MAX_HISTORY_TOKENS instead */
export const MAX_HISTORY_TOKENS = DEFAULT_MAX_HISTORY_TOKENS;

// ─────────────────────────────────────────────────────────────────────────────
// 公共类型定义
// ─────────────────────────────────────────────────────────────────────────────

export { ChatMessage, ChatToolCall, MessageRole, type TokenUsage };

export enum GraphNodeType {
    AGENT = "agent",
    TOOLS = "tools",
}

export enum ToolApproval {
    /** 拒绝本次执行 */
    Deny = "deny",
    /** 同意本次执行 */
    Allow = "allow",
    /** 一直同意（相同参数） */
    AlwaysArgs = "alwaysArgs",
    /** 一直同意（此工具所有参数） */
    AlwaysTool = "alwaysTool",
}


/**
 * Agent 回调接口 - 统一管理消息、流式、工具确认和图片转换回调
 */
export interface IAgentCallback {
    /**
     * 接收完整的消息（在节点输出完成后触发）
     */
    onMessage?(message: ChatMessage): Promise<void>;

    /**
     * 接收实时的流式消息块（在模型生成过程中触发）
     */
    onStreamMessage?(message: ChatMessage): Promise<void>;

    /**
     * 工具执行前进行确认
     * @returns ToolApproval 枚举，表示执行意图
     */
    executeTool?(toolCall: ChatToolCall): Promise<ToolApproval>;

    /**
     * 每次模型调用后报告 token 用量
     */
    onUsage?(usage: TokenUsage): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 共享类型 / Token
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentSubNode {
  id: string;
  name?: string;
  desc: string;
}

/**
 * 创建子 Agent 的工厂函数
 * 由调用方（如 AgentFactory）传入，封装 userInfo 等上下文，
 * 使编排 Agent 无需关心具体的 Agent 创建细节。
 */
export type CreateAgentFn = (agentName: string, container: ServiceContainer) => Promise<AgentServiceBase>;

export const T_CreateAgent = Symbol("scorpio:T_CreateAgent");
export const T_SummaryModelService = Symbol("scorpio:T_SummaryModelService");

// ─────────────────────────────────────────────────────────────────────────────
// AgentServiceBase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent 服务基类
 * 仅保留所有 Agent 共用的最小状态：saver、note、logger 和系统提示词管理。
 * 模型、技能、工具等 SingleAgent 专属逻辑由 SingleAgentService 自行持有。
 */
export class AgentCancelledError extends Error {
    constructor() {
        super('Agent execution cancelled');
        this.name = 'AgentCancelledError';
    }
}

export abstract class AgentServiceBase {
    protected saverService: IAgentSaverService;
    protected noteServices: INoteService[];
    protected wikiServices: IWikiService[];
    protected loggerService?: ILoggerService;
    protected logger?: ILogger;
    constructor(
        loggerService?: ILoggerService,
        agentSaver?: IAgentSaverService,
        noteServices?: INoteService[],
        wikiServices?: IWikiService[],
    ) {
        this.saverService = agentSaver ?? new AgentMemorySaver();
        this.noteServices = noteServices ?? [];
        this.wikiServices = wikiServices ?? [];
        this.loggerService = loggerService;
        this.logger = loggerService?.getLogger(this.constructor.name);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    addStaticSystemPrompts(_prompts: string[]): void {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    addDynamicSystemPrompts(_prompts: string[]): void {}

    /**
     * 以无回调方式调用 stream，返回 stream 的结果消息列表。
     */
    invoke(query: MessageContent, signal?: AbortSignal): Promise<ChatMessage[]> {
        return this.stream(query, {}, signal);
    }

    abstract stream(query: MessageContent, callback: IAgentCallback, signal?: AbortSignal): Promise<ChatMessage[]>;

    /**
     * 按 maxImageSize 等比缩放图片 part；text/audio/未知 part 透传。
     * 用户输入（stream 入口）和工具结果（callToolsNode）共用此入口，
     * 保证所有进入对话历史的图片走统一规则。
     */
    protected async resizeImagesInContent(content: MessageContent): Promise<MessageContent> {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return content;
        return Promise.all(content.map(async (part: ContentPart): Promise<ContentPart> => {
            if (part.type === 'image' && typeof part.data === 'string') {
                const buf = Buffer.from(part.data, 'base64');
                const resized = await resizeImageIfNeeded(buf);
                if (resized === buf) return part;
                return { type: 'image_url', image_url: { url: `data:${detectImageMimeType(resized)};base64,${resized.toString('base64')}` } };
            }
            if (part.type === 'image_url') {
                const raw = part.image_url ?? part.url;
                const url = typeof raw === 'string' ? raw : raw?.url;
                if (typeof url !== 'string') return part;
                const resizedUrl = await resizeImageIfNeeded(url);
                if (resizedUrl === url) return part;
                return { type: 'image_url', image_url: { url: resizedUrl } };
            }
            return part;
        }));
    }

    /**
     * 将运行/工具异常以 {@link MessageKind.Exception} 形式落库，便于回溯。
     * 取消（{@link AgentCancelledError}）不记录；落库失败仅日志告警，不影响原始 error 的传播。
     */
    protected async recordException(error: unknown, options?: { thinkId?: string }): Promise<void> {
        if (error instanceof AgentCancelledError) return;
        const e = error as { name?: string; message?: string };
        const text = `[${e?.name ?? 'Error'}] ${e?.message ?? String(error)}`;
        try {
            await this.saverService.pushMessage(
                { role: MessageRole.System, content: text },
                { kind: MessageKind.Exception, ...(options?.thinkId ? { thinkId: options.thinkId } : {}) },
            );
        } catch (saveErr: any) {
            this.logger?.warn(`Failed to record exception to saver: ${saveErr?.message ?? saveErr}`);
        }
    }

    /**
     * 释放资源
     */
    async dispose() {
        await this.saverService.dispose();
        await Promise.all(this.noteServices.map(n => n.dispose()));
        await Promise.all(this.wikiServices.map(w => w.dispose()));
    }

}
