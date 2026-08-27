import { z } from "zod";

/**
 * 轻量结构化工具接口 —— 全项目的工具边界。
 *
 * 替代 @langchain/core 的 StructuredToolInterface：工具生产方（内置工具、MCP 包装、
 * plugins）与消费方（各 LLM provider 的 bindTools、Agent 执行链路）只依赖这四个成员。
 * schema 统一为 JSON Schema 纯对象（zod 由 createAgentTool 自动转换）。
 */
export interface AgentTool {
    readonly name: string;
    readonly description?: string;
    /** 工具入参的 JSON Schema */
    readonly schema: Record<string, any>;
    invoke(input: Record<string, any>, config?: ToolInvokeConfig): Promise<any>;
}

/**
 * 工具执行时框架注入的上下文。
 * 原先塞在 LangChain RunnableConfig.configurable 里的 think 预留约定，现在有真实类型。
 */
export interface ToolInvokeConfig {
    /** 取消信号 */
    signal?: AbortSignal;
    /** think 流预留 id：框架执行工具前生成，工具派发子思考流时与之关联 */
    thinkId?: string;
    /** 工具启动子思考流时声明一次（见 SingleAgentService 的 think 预留逻辑） */
    onCreateThink?: (taskId: string) => Promise<void>;
}

/** createAgentTool 的定义参数 */
export interface ToolDefinition {
    name: string;
    description?: string;
    /** zod schema 或 JSON Schema 纯对象 */
    schema: z.ZodType | Record<string, any>;
    func: (input: any, config?: ToolInvokeConfig) => Promise<any>;
}

/**
 * 创建结构化工具 —— 对应原先的 new DynamicStructuredTool({...})。
 *
 * zod schema 会在构造时转换为 JSON Schema 暴露给模型，并在 invoke 时对入参
 * 做 parse 校验（默认值 / 类型收敛 / 未知字段剥离），与 DynamicStructuredTool 行为一致；
 * parse 失败抛 ZodError，由 Agent 执行链路统一转为 error ToolMessage。
 */
export function createAgentTool(def: ToolDefinition): AgentTool {
    const zodSchema = isZodSchema(def.schema) ? def.schema : undefined;
    // io:"input" 视角：带默认值的字段不再出现在 required 里（模型侧可省略，
    // invoke 时由 zod parse 补默认值）
    const jsonSchema = zodSchema ? z.toJSONSchema(zodSchema, { io: "input" }) : def.schema as Record<string, any>;
    return {
        name: def.name,
        description: def.description,
        schema: jsonSchema,
        invoke: async (input, config) => {
            const parsed = zodSchema ? zodSchema.parse(input) : input;
            return def.func(parsed, config);
        },
    };
}

function isZodSchema(schema: unknown): schema is z.ZodType {
    return !!schema && typeof schema === "object" && typeof (schema as z.ZodType).parse === "function";
}

/**
 * 将 Zod schema 统一转换为 JSON Schema 纯对象；已是普通对象（JSON Schema）时原样返回。
 * 供各 provider 在结构化输出（invokeStructured）时使用。
 */
export function toJsonSchema(schema: any): any {
    if (isZodSchema(schema)) {
        return z.toJSONSchema(schema);
    }
    return schema;
}

/**
 * 转换为 OpenAI 工具调用格式。
 * LangChain 各 chat 模型（ChatOllama / ChatGoogleGenerativeAI 等）的 bindTools 对
 * 非 LangChain 工具会按格式识别透传：OpenAI 格式（isOpenAITool）可被正确转换。
 */
export function toOpenAIToolFormat(tool: AgentTool): {
    type: "function";
    function: { name: string; description?: string; parameters: Record<string, any> };
} {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.schema,
        },
    };
}
