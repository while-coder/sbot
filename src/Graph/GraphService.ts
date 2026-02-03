import { HumanMessage, AIMessage, ToolMessage, BaseMessage, AIMessageChunk } from "langchain";
import { AgentRow, database } from "../Database";
import { Util } from "weimingcommons";
import { ChatOpenAI } from "@langchain/openai";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {StateGraph, END, START, MessagesAnnotation, CompiledStateGraph} from '@langchain/langgraph';

import log4js from "log4js";
import {PostgresSaver} from "@langchain/langgraph-checkpoint-postgres";
import {BaseUserService} from "../UserService/BaseUserService";
// import { TextSplitter } from '@langchain/textsplitters'

const logger = log4js.getLogger("GraphService.ts");
type LangChainToolCall = {
    id: string;
    name: string;
    args: unknown;
};

export type LangChainMessageChunk =
    | {
    type: "ai";
    content: string;
    tool_calls: LangChainToolCall[];
}
    | {
    type: "tool";
    tool_call_id: string;
    status?: string;
    content?: string;
};

/**
 * 使用 LangGraph 的 StateGraph 构建的 Agent 服务
 * 提供更灵活的工作流控制和状态管理
 */
class GraphService {
    userService:BaseUserService;
    chatId = "";
    tools: any[] = [];
    disabledAutoApproveTools: Set<string> = new Set<string>();
    saver:PostgresSaver|undefined;
    graph: CompiledStateGraph<typeof MessagesAnnotation.State, any, any, any, any, any, any, any, any> | null = null;
    agentConfig: AgentRow | undefined;
    model: ChatOpenAI | null = null;

    constructor(userService:BaseUserService) {
        this.userService = userService
    }

    get userId() { return this.userService.userId; }
    /**
     * 获取或创建 Agent 配置
     */
    async getAgentConfig(): Promise<AgentRow> {
        // RecursiveCharacterTextSplitter e;
        if (this.agentConfig != undefined) return this.agentConfig;

        let agentConfig = await database.findOne<AgentRow>(database.agent, {
            where: { userid: this.userId },
            order: [["activeTime", "DESC"]],
        });
        
        if (agentConfig == null) {
            this.agentConfig = await database.create<AgentRow>(database.agent, { 
                userid: this.userId, 
                name: "default",
                config: "{}",
                mcp: "{}",
                system: "",
                activeTime: Util.NowDate 
            });
        } else {
            this.agentConfig = agentConfig;
        }
        
        return this.agentConfig;
    }

    async clear() {
        const agentConfig = await this.getAgentConfig()
        const saver = await this.createSaver()
        await saver.deleteThread(`${agentConfig.id}`)
    }
    /**
     * 初始化工具
     */
    async createTools() {
        if (this.tools.length > 0) return this.tools;

        let agentConfig = await this.getAgentConfig();
        this.disabledAutoApproveTools = new Set<string>()
        this.tools = []
        const AddMcpServers = async (mcpServers:any) => {
            if (Object.keys(mcpServers).length == 0) return
            for (let key in mcpServers)  {
                if (mcpServers[key]?.disabledAutoApproveTools != null) {
                    mcpServers[key].disabledAutoApproveTools.forEach((tool: string) => {
                        this.disabledAutoApproveTools.add(tool);
                    });
                }
            }
            const mcpClient = new MultiServerMCPClient({ mcpServers });
            let tools = await mcpClient.getTools()
            for (let tool of tools) {
                if (this.tools.findIndex(x => x.name == tool.name) < 0) {
                    this.tools.push(tool)
                }
            }
        }
        await AddMcpServers(Util.parseJson<{}>(agentConfig!.mcp!, {})!)
        await AddMcpServers({
            WMToolsHttp: {
                type: "http",
                url: "http://da2.diandian.info:5200/mcp",
                disabledAutoApproveTools: [
                    "buildtools_execute_command",
                    "buildtools_execute_task_operation",
                    "buildtools_set_config",
                ]
            },
            TgaHttp: {
                type: "http",
                url: "http://da2.diandian.info:5200/tga",
            }
        })
        return this.tools;
    }
    /**
     * 初始化 OpenAI 模型
     */
    async createModel(): Promise<ChatOpenAI> {
        if (this.model != null) return this.model;

        let agentConfig = await this.getAgentConfig();
        let config = Util.parseJson<{ url: string, apiKey: string, model: string }>(
            agentConfig!.config!,
            {
                apiKey: "",
                model: "",
                url: ""
            }
        )!;

        let openAIUrl = "https://lumos.diandian.info/winky/openai/v1";
        let openAIKey = "lumos-ca1e042afd6ee4ba460a66966e81d6d03eded01f1c5e79727df58d1f6a9f51f18f2b7ebc338ce8f373ae886e6b2c1cce80783db1693d41301209fd91c71ea75e.81b95584e904e5cb8ceeaed5a3a39390";
        let openAIModel = "gpt-5.2";

        if (!Util.isNullOrEmpty(config.url) &&
            !Util.isNullOrEmpty(config.apiKey) &&
            !Util.isNullOrEmpty(config.model)
        ) {
            openAIUrl = config.url;
            openAIKey = config.apiKey;
            openAIModel = config.model;
        }

        this.model = new ChatOpenAI({
            configuration: {
                baseURL: openAIUrl,
                apiKey: openAIKey,
                defaultHeaders: {
                    Authorization: `Bearer ${openAIKey}`,
                },
            },
            apiKey: openAIKey,
            model: openAIModel,
        });

        return this.model;
    }

    /**
     * 判断是否应该继续执行
     */
    agentNext(state: typeof MessagesAnnotation.State): "tools" | typeof END {
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1] as AIMessage;

        // 如果 LLM 调用了工具，则路由到 tools 节点
        if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
            return "tools";
        }
        // 否则结束
        return END;
    }
    /**
     * 调用模型节点
     */
    async callModelNode(state: typeof MessagesAnnotation.State) {
        const agentConfig = await this.getAgentConfig();
        const model = await this.createModel();
        const tools = await this.createTools();

        // 绑定工具到模型
        const modelWithTools = model.bindTools(tools);

        // 添加系统提示
        const systemMessage = `${agentConfig?.system || "你是一个有用的AI助手。"}
当前时间为:${Util.NowTimeString}
当前用户UserId:${this.userId}
当前会话ID:${this.chatId}`;
        const messages = [
            { role: "system", content: systemMessage },
            ...state.messages
        ];
        // 使用流式调用收集完整响应
        const stream = await modelWithTools.stream(messages);

        let response:AIMessageChunk|undefined
        // 收集所有流式片段
        for await (const chunk of stream) {
            if (response == undefined) {
                response = chunk
            } else {
                response = response.concat(chunk)
            }
            if (!Util.isNullOrEmpty(response.text)) {
                await this.userService.onStreamMessage(response?.text)
            }
        }
        // 返回新的状态，LangGraph 会自动合并消息
        return { messages: [response] };
    }

    /**
     * 工具执行节点 - 替代 ToolNode
     */
    async callToolsNode(state: typeof MessagesAnnotation.State) {
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1] as AIMessage;
        
        // 获取工具调用
        const toolCalls = lastMessage.tool_calls || [];
        if (toolCalls.length === 0) {
            return { messages: [] };
        }
        // 获取可用工具
        const tools = await this.createTools();
        const toolMap = new Map(tools.map(t => [t.name, t]));

        // 执行所有工具调用
        const toolMessages: ToolMessage[] = [];
        for (const toolCall of toolCalls) {
            const tool = toolMap.get(toolCall.name);
            if (!tool) {
                // 工具不存在
                toolMessages.push(
                    new ToolMessage({
                        tool_call_id: toolCall.id || "",
                        content: `Error: Tool '${toolCall.name}' not found`,
                        status: "error"
                    })
                );
                continue;
            }
            try {
                let ok = this.disabledAutoApproveTools.has(tool.name) ? (await this.userService.executeTool(toolCall)) : true
                if (ok) {
                    // 执行工具
                    const result = await tool.invoke(toolCall.args);
                    toolMessages.push(
                        new ToolMessage({
                            tool_call_id: toolCall.id || "",
                            content: typeof result === "string" ? result : JSON.stringify(result),
                            status: "success"
                        })
                    );
                } else {
                    toolMessages.push(
                        new ToolMessage({
                            tool_call_id: toolCall.id || "",
                            content: "<font color='red'>用户拒绝调用</font>",
                            status: "error"
                        })
                    );
                }
            } catch (error: any) {
                // 工具执行失败
                toolMessages.push(
                    new ToolMessage({
                        tool_call_id: toolCall.id || "",
                        content: `<font color='red'>Error executing tool: ${error.message}</font>`,
                        status: "error"
                    })
                );
            }
        }

        return { messages: toolMessages };
    }

    async createSaver():Promise<PostgresSaver> {
        if (this.saver != null) return this.saver;
        const connectionString = `postgresql://postgres:funplus123@da2.diandian.info:5432/feishu`;
        // 初始化 PostgresSaver
        this.saver = PostgresSaver.fromConnString(connectionString);
        await this.saver.setup();
        return this.saver;
    }
    /**
     * 使用 LangGraph 创建 Agent 图
     */
    async createGraph() {
        if (this.graph != null) return this.graph;

        // 初始化工具
        await this.createTools();
        // 创建状态图
        const workflow = new StateGraph(MessagesAnnotation)
            // 添加节点
            .addNode("agent", this.callModelNode.bind(this))
            .addNode("tools", this.callToolsNode.bind(this))
            // 添加边
            .addEdge(START, "agent")
            .addConditionalEdges("agent", this.agentNext.bind(this))
            .addEdge("tools", "agent");

        // 编译图，使用 PostgresSaver
        this.graph = workflow.compile({
            checkpointer: await this.createSaver()
        });
        
        return this.graph;
    }

    /**
     * 流式处理用户查询
     */
    async stream(chatId: string, query: string): Promise<any> {
        this.chatId = chatId;
        
        // 添加用户消息到历史
        const humanMessage = new HumanMessage(query);
        const agentConfig = await this.getAgentConfig()
        // 创建图
        const graph = await this.createGraph();
        // 流式执行图 - 使用 updates 模式，每次只返回该步骤的更新
        const stream = await graph.stream(
            { messages: [humanMessage] },
            { streamMode: "updates", configurable: { thread_id: `${agentConfig.id}` } }
        );

        // 处理流式输出
        for await (const update of stream) {
            // update 是一个对象，键是节点名称，值是该节点的输出
            // 例如: { agent: { messages: [...] } } 或 { tools: { messages: [...] } }
            // logger.info("update", update);
            for (const [nodeName, nodeOutput] of Object.entries(update)) {
                // logger.info(`节点 ${nodeName} 输出:`, nodeOutput);
                
                // 获取该节点输出的消息
                const messages = (nodeOutput as any).messages || [];
                
                // 处理每条新消息
                for (const message of messages) {
                    // 跳过人类消息
                    if (message instanceof HumanMessage) continue;
                    
                    // 转换为回调格式
                    const messageChunk = this.convertToMessageChunk(message);
                    if (messageChunk) {
                        await this.userService.onMessage(messageChunk!)
                    }
                }
            }
        }
    }
    /**
     * 将 BaseMessage 转换为 LangChainMessageChunk 格式
     */
    private convertToMessageChunk(message: BaseMessage): LangChainMessageChunk | null {
        if (message instanceof AIMessage || message instanceof AIMessageChunk) {
            // 转换工具调用格式
            const toolCalls: LangChainToolCall[] = (message.tool_calls || []).map(tc => ({
                id: tc.id || "",
                name: tc.name,
                args: tc.args
            }));
            return {
                type: "ai",
                content: message.text as string,
                tool_calls: toolCalls
            };
        } else if (message instanceof ToolMessage) {
            return {
                type: "tool",
                tool_call_id: message.tool_call_id || "",
                status: message.status,
                content: (message.content as string).trim()
            };
        }
        return null;
    }
}

export default GraphService
