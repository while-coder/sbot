import { HumanMessage, AIMessage, ToolMessage, BaseMessage, AIMessageChunk } from "langchain";
import { Util } from "weimingcommons";
import { ChatOpenAI } from "@langchain/openai";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import {StateGraph, END, START, MessagesAnnotation} from '@langchain/langgraph';
import {SqliteSaver} from "@langchain/langgraph-checkpoint-sqlite";
import {config} from "../Config";
import {LoggerService} from "../LoggerService";
import { loadSkills, Skill, createSkillTools } from "../Skills";
// import { TextSplitter } from '@langchain/textsplitters'

const logger = LoggerService.getLogger("AgentService.ts");

export enum MessageChunkType {
    AI = "ai",
    TOOL = "tool"
}

export type AgentToolCall = {
    id?: string;
    name: string;
    args: Record<string, any>;
};

export type AgentMessage = {
    type: MessageChunkType;
    content?: string;
    tool_calls?: AgentToolCall[];
    tool_call_id?: string;
    status?: string;
};

/**
 * 工具调用回调类型 - 用于在工具执行前进行确认
 * @param toolCall 工具调用信息
 * @returns Promise<boolean> - true 表示允许执行，false 表示拒绝执行
 */
export type ExecuteToolCallback = (toolCall: AgentToolCall) => Promise<boolean>;

/**
 * 消息回调类型 - 用于接收完整的消息（在节点输出完成后触发）
 * @param message 消息块
 */
export type OnMessageCallback = (message: AgentMessage) => Promise<void>;

/**
 * 流式消息回调类型 - 用于接收实时的流式消息块（在模型生成过程中触发）
 * @param message 消息块
 */
export type OnStreamMessageCallback = (message: AgentMessage) => Promise<void>;

/**
 * 使用 LangGraph 的 StateGraph 构建的 Agent 服务
 * 提供更灵活的工作流控制和状态管理
 */
export class AgentService {
    private threadId: string;
    tools: any[] = [];
    disabledAutoApproveTools: Set<string> = new Set<string>();
    saver:SqliteSaver|undefined;
    model: ChatOpenAI | null = null;
    private skills: Skill[]|undefined;
    private skillsDir: string = "";
    private maxHistoryMessages: number = 5; // 最大历史消息数

    constructor(userId: string, skillsDir?: string) {
        this.threadId = userId;
        // 如果未指定 skills 目录，使用配置目录下的 skills 文件夹
        this.skillsDir = skillsDir || config.getConfigPath("skills", true);
    }

    /**
     * 清除当前线程的所有历史记录
     */
    async clear() {
        const saver = await this.createSaver()
        await saver.deleteThread(this.threadId)
        logger.info(`清除用户 ${this.threadId} 的所有历史记录`)
    }

    /**
     * 释放资源
     */
    async dispose() {
        if (this.saver) {
            try {
                // SqliteSaver 通常会有 end() 或类似方法来关闭数据库连接
                // @ts-ignore - SqliteSaver 可能有 db 属性用于访问底层数据库
                if (this.saver.db && typeof this.saver.db.close === 'function') {
                    await this.saver.db.close();
                }
            } catch (error: any) {
                logger.warn(`用户 ${this.threadId} 释放saver 资源时出错: ${error.message}`);
            } finally {
                this.saver = undefined;
            }
        }
    }

    /**
     * 加载 skills
     */
    private loadSkills() {
        if (this.skills) return;

        try {
            this.skills = loadSkills(this.skillsDir);
        } catch (error: any) {
            logger.error(`用户 ${this.threadId} 加载 skills 失败: ${error.message}`);
        }
    }
    /**
     * 初始化工具
     */
    private async createTools() {
        if (this.tools.length > 0) return this.tools;

        this.disabledAutoApproveTools = new Set<string>()
        this.tools = []

        // 添加 skill 工具
        const skillTools = createSkillTools(this.skillsDir);
        this.tools.push(...skillTools);

        // 工具需要通过配置或外部方式添加
        // 可以通过 addMcpServers 方法动态添加

        return this.tools;
    }

    /**
     * 添加 MCP 服务器工具
     */
    async addMcpServers(mcpServers: any) {
        if (Object.keys(mcpServers).length == 0) return

        for (let key in mcpServers) {
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
    /**
     * 初始化 OpenAI 模型
     */
    private async createModel(): Promise<ChatOpenAI> {
        if (this.model != null) return this.model;

        const modelConfig = config.getCurrentModel();

        if (!modelConfig ||
            Util.isNullOrEmpty(modelConfig.baseURL) ||
            Util.isNullOrEmpty(modelConfig.apiKey) ||
            Util.isNullOrEmpty(modelConfig.model)
        ) {
            throw new Error("模型配置不完整，请在配置文件中正确配置当前使用的模型");
        }

        this.model = new ChatOpenAI({
            configuration: {
                baseURL: modelConfig!.baseURL,
                apiKey: modelConfig!.apiKey,
                defaultHeaders: {
                    Authorization: `Bearer ${modelConfig!.apiKey}`,
                },
            },
            apiKey: modelConfig!.apiKey,
            model: modelConfig!.model,
        });

        return this.model;
    }

    /**
     * 判断是否应该继续执行
     */
    private agentNext(state: typeof MessagesAnnotation.State): "tools" | typeof END {
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
    private async callModelNode(state: typeof MessagesAnnotation.State, onStreamMessage?: OnStreamMessageCallback) {
        const model = await this.createModel();
        const tools = await this.createTools();

        // 加载 skills
        this.loadSkills();

        // 绑定工具到模型
        const modelWithTools = model.bindTools(tools);

        // 构建基础系统提示词
        const systemMessages = [
            { role: "system", content: `你是一个有用的AI助手。` },
        ];

        // 构建 skills 系统提示词
        if (this.skills && this.skills.length > 0) {
            const skillsList = this.skills.map(skill =>
                `- ${skill.name}: ${skill.path}\n  ${skill.description}`
            ).join('\n');

            const skillSystemMessage = `
# 🎯 Skills 系统

你拥有一套专为特定任务优化的 **Skills**。当用户的请求与下列任意 skill 的描述相关时，你**必须立即使用**对应的 skill。

## 📋 可用的 Skills 列表

${skillsList}

**Skills 存储路径**: ${this.skillsDir}

---

## 🔍 识别与匹配规则

**关键原则**: 根据用户请求的**关键词、任务类型、文件类型**来匹配 skill。

匹配示例：
- 用户提到 "PDF"、"表格提取"、"填写 PDF" → 使用 **pdf** skill
- 用户提到 "Excel"、"xlsx"、"电子表格" → 使用 **xlsx** skill
- 用户提到 "Unity shader"、"着色器分析" → 使用 **unity-shader-analyzer** skill
- 用户提到 "创建 skill"、"新建 skill" → 使用 **skill-creator** skill

## ⚡ 使用流程（必须遵守）

当匹配到 skill 时，立即执行以下步骤：

1. **告知用户**："我将使用 '{skill-name}' skill 来处理这个任务"
2. **读取 SKILL.md**：使用 \`read_skill_file\` 工具读取 SKILL.md 文件
   - skillName: skill 名称
   - filePath: "SKILL.md"
3. **理解指导**：仔细阅读 SKILL.md 中的完整工作流程和指导说明
4. **严格执行**：完全按照 skill 中的指导和步骤来完成任务
5. **访问资源**：如果 skill 引用了其他文件，使用以下工具：
   - \`list_skill_files\`: 查看 skill 目录结构
   - \`read_skill_file\`: 读取 skill 目录下的任何文件
   - \`execute_skill_script\`: 执行 skill 中的脚本（.py, .sh, .js, .ts）

## 🛠️ 可用的 Skill 工具

你有以下工具来操作 skills：

- **read_skill_file**: 读取 skill 目录下的任何文件（SKILL.md、scripts/、references/ 等）
- **list_skill_files**: 列出 skill 的目录结构，查看包含哪些文件
- **execute_skill_script**: 执行 skill 中的脚本文件

## ⚠️ 重要约束

- ✅ **必须使用工具**：使用 \`read_skill_file\` 工具读取文件，不要尝试猜测文件内容
- ✅ **必须先读取 SKILL.md**：在执行任何 skill 相关操作前，必须先读取并理解 SKILL.md
- ✅ **严格遵循指导**：SKILL.md 中的指导是权威的，必须完全遵守
- ✅ **主动识别**：不要等用户明确说"使用某个 skill"，要主动识别和使用
- ❌ **禁止猜测**：如果不确定 skill 的使用方式，必须先读取 SKILL.md`;
            systemMessages.push({ role: "system", content: skillSystemMessage });
        }

        // 限制历史消息数量，只保留最近的消息
        let historyMessages = state.messages;
        if (historyMessages.length > this.maxHistoryMessages) {
            // 保留最近的消息
            historyMessages = historyMessages.slice(-this.maxHistoryMessages);
        }

        // 所有提示词
        const messages = [
            ...systemMessages,
            ...historyMessages,
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
            if (onStreamMessage) {
                // 转换为回调格式
                const messageChunk = this.convertToMessageChunk(response);
                if (messageChunk) {
                    await onStreamMessage(messageChunk!)
                }
            }
        }
        // 返回新的状态，LangGraph 会自动合并消息
        return { messages: [response] };
    }

    /**
     * 工具执行节点 - 替代 ToolNode
     */
    private async callToolsNode(state: typeof MessagesAnnotation.State, executeTool?: ExecuteToolCallback) {
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
                let ok = true;
                if (executeTool && this.disabledAutoApproveTools.has(tool.name)) {
                    ok = await executeTool(toolCall);
                }
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

    private async createSaver():Promise<SqliteSaver> {
        if (this.saver != null) return this.saver;
        // 使用 SQLite 数据库作为 checkpoint 存储
        const {config} = await import("../Config");
        const dbPath = config.getConfigPath(`saver/${this.threadId}.sqlite`);
        // 初始化 SqliteSaver (无需手动调用 setup，会自动初始化)
        this.saver = SqliteSaver.fromConnString(dbPath);
        return this.saver;
    }
    /**
     * 使用 LangGraph 创建 Agent 图
     * @param onStreamMessage 流式消息回调，通过闭包传递给 callModelNode，避免实例属性冲突
     * @param executeTool 工具执行回调，通过闭包传递给 callToolsNode
     */
    private async createGraph(onStreamMessage?: OnStreamMessageCallback, executeTool?: ExecuteToolCallback) {
        // 初始化工具
        await this.createTools();
        // 创建状态图，使用闭包传递回调
        const workflow = new StateGraph(MessagesAnnotation)
            // 添加节点 - 使用闭包绑定回调
            .addNode("agent", (state) => this.callModelNode(state, onStreamMessage))
            .addNode("tools", (state) => this.callToolsNode(state, executeTool))
            // 添加边
            .addEdge(START, "agent")
            .addConditionalEdges("agent", this.agentNext.bind(this))
            .addEdge("tools", "agent");

        // 编译图，使用 SqliteSaver
        const saver = await this.createSaver()
        return workflow.compile({
            checkpointer: saver
        });
    }

    /**
     * 流式处理用户查询
     */
    async stream(query: string, onMessage: OnMessageCallback, onStreamMessage?: OnStreamMessageCallback, executeTool?: ExecuteToolCallback): Promise<void> {
        try {
            // 添加用户消息到历史
            const humanMessage = new HumanMessage(query);

            // 检查是否需要清理历史记录
            const historyMessages = await this.prepareHistoryForStream();

            // 准备要传递的消息
            // 如果已经清理过历史，使用清理后的消息；否则只传递当前消息
            const inputMessages = historyMessages.length > 0
                ? [...historyMessages, humanMessage]
                : [humanMessage];

            // 为本次调用创建独立的图，通过闭包传递回调
            const graph = await this.createGraph(onStreamMessage, executeTool);
            // 流式执行图 - 使用 updates 模式，每次只返回该步骤的更新
            // 使用 userId 作为 thread_id
            const stream = await graph.stream(
                { messages: inputMessages },
                { streamMode: "updates", configurable: { thread_id: this.threadId } }
            );

            // 处理流式输出
            for await (const update of stream) {
                // update 是一个对象，键是节点名称，值是该节点的输出
                // 例如: { agent: { messages: [...] } } 或 { tools: { messages: [...] } }
                for (const [, nodeOutput] of Object.entries(update)) {
                    // 获取该节点输出的消息
                    const messages = (nodeOutput as any).messages || [];

                    // 处理每条新消息
                    for (const message of messages) {
                        // 跳过人类消息
                        if (message instanceof HumanMessage) continue;

                        // 转换为回调格式
                        const messageChunk = this.convertToMessageChunk(message);
                        if (messageChunk) {
                            await onMessage(messageChunk!)
                        }
                    }
                }
            }

        } finally {
            // 确保释放资源
            await this.dispose();
        }
    }

    /**
     * 准备历史记录用于 stream
     * 如果历史记录超过限制，返回截断后的历史消息并清理 saver
     * 否则返回空数组（使用 saver 中的历史）
     */
    private async prepareHistoryForStream(): Promise<BaseMessage[]> {
        try {
            const saver = await this.createSaver();

            // 获取当前状态
            const currentState = await saver.get({ configurable: { thread_id: this.threadId } });

            if (currentState?.channel_values) {
                const channelValues = currentState.channel_values as any;

                if (channelValues.messages && Array.isArray(channelValues.messages)) {
                    const allMessages = channelValues.messages;

                    // 如果超过最大限制，需要清理
                    if (allMessages.length > this.maxHistoryMessages) {
                        // 只保留最近的消息
                        const recentMessages = allMessages.slice(-this.maxHistoryMessages);

                        // 删除旧的 thread（清理数据库）
                        await saver.deleteThread(this.threadId);

                        logger.info(`用户 ${this.threadId} 历史消息数 ${allMessages.length} 超过限制 ${this.maxHistoryMessages}，开始清理多余的消息...`);

                        // 返回截断后的历史消息，让 graph.stream 重新初始化
                        return recentMessages;
                    }
                }
            }

            // 历史未超限，返回空数组，使用 saver 中的历史
            return [];

        } catch (error: any) {
            logger.warn(`用户 ${this.threadId} 检查历史记录时出错: ${error.message}`);
            return [];
        }
    }

    /**
     * 将 BaseMessage 转换为 LangChainMessageChunk 格式
     */
    private convertToMessageChunk(message: BaseMessage): AgentMessage | null {
        if (message instanceof AIMessage || message instanceof AIMessageChunk) {
            // 转换工具调用格式
            const toolCalls: AgentToolCall[] = (message.tool_calls || []).map(tc => ({
                id: tc.id || "",
                name: tc.name,
                args: tc.args
            }));
            return {
                type: MessageChunkType.AI,
                content: message.text as string,
                tool_calls: toolCalls
            };
        } else if (message instanceof ToolMessage) {
            return {
                type: MessageChunkType.TOOL,
                tool_call_id: message.tool_call_id || "",
                status: message.status,
                content: (message.content as string).trim()
            };
        } else {
            logger.warn(`用户 ${this.threadId} 未知AI消息类型 : ${message.constructor.name}`);
        }
        return null;
    }
}