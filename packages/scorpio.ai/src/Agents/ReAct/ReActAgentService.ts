import { BaseMessage, HumanMessage, AIMessage, AIMessageChunk, SystemMessage, ToolMessage } from "langchain";
import { DynamicTool } from "langchain";
import { inject, ServiceContainer } from "../../Core";
import { IMemoryService, ReadOnlyMemoryService } from "../../Memory";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { AgentServiceBase, IAgentCallback, AgentSubNode, CreateAgentFn, T_CreateAgent, T_SummaryModelService, MAX_HISTORY_TOKENS } from "../AgentServiceBase";
import { AgentMemorySaver } from "../../Saver/AgentMemorySaver";

// ── Tokens ────────────────────────────────────────────────────

export const T_AgentSubNodes = Symbol("scorpio:T_AgentSubNodes");
export const T_MaxIterations = Symbol("scorpio:T_MaxIterations");
export const T_ThinkModelService = Symbol("scorpio:T_ThinkModelService");
export const T_ReflectModelService = Symbol("scorpio:T_ReflectModelService");

export enum ReActNode {
  Think = "think",
  ThinkError = "think_error",
  WaitForUser = "wait_for_user",
  Action = "action",
  Result = "result",
  Reflect = "reflect",
}

export interface ReActAction {
  agentName: string;
  goal: string;
  task: string;
  systemPrompt?: string;
}

export interface ReActStep {
  type: ReActNode;
  content: string;
}


// ── ReActAgentService ─────────────────────────────────────────

/**
 * ReAct Agent 服务，参照 createAgent 源码实现 Reasoning and Acting 模式的多 Agent 协同。
 *
 * 手写 ReAct 循环（对照 createAgent / ReactAgent 内部结构）：
 *   Agent 节点：model.bindTools(tools).stream(messages)
 *   条件边：   AIMessage 有 tool_calls → Tools 节点，无 → 结束
 *   Tools 节点：逐个执行工具调用，结果追加为 ToolMessage
 *   最终由 reflectModelService 生成总结
 */
export class ReActAgentService extends AgentServiceBase {
  private thinkModelService: IModelService;
  private reflectModelService: IModelService;
  private summaryModelService: IModelService;
  private agentSubNodes: AgentSubNode[];
  private agentFactory: CreateAgentFn;
  private maxIterations: number;

  constructor(
    @inject(T_ThinkModelService) thinkModelService: IModelService,
    @inject(T_ReflectModelService) reflectModelService: IModelService,
    @inject(T_SummaryModelService) summaryModelService: IModelService,
    @inject(T_AgentSubNodes) agentSubNodes: AgentSubNode[],
    @inject(T_CreateAgent) agentFactory: CreateAgentFn,
    @inject(T_MaxIterations, { optional: true }) maxIterations?: number,
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    super(loggerService, agentSaver, memoryService);
    this.thinkModelService = thinkModelService;
    this.agentSubNodes = agentSubNodes;
    this.maxIterations = maxIterations ?? 5;
    this.reflectModelService = reflectModelService;
    this.summaryModelService = summaryModelService;
    this.agentFactory = agentFactory;
  }

  // ── System Prompt ────────────────────────────────────────────

  private buildThinkSystemPrompt(): string {
    const agentsDesc = this.agentSubNodes.map(a => `- ${a.name}: ${a.desc}`).join('\n');
    return `你是 ReAct 编排专家，负责分析任务进展并协调多个专业 Agent 完成复杂任务。

## 可用工具（子 Agent）
${agentsDesc}

## 工作原则
1. **逐步推进**：每次调用一个工具，观察结果后再决定下一步
2. **自包含任务**：传给工具的指令必须包含所有必要上下文，工具无需查阅历史即可执行
3. **避免重复**：某个工具已成功完成特定目标，不要重复调用
4. **及时完成**：所有目标均已达成时，直接回复用户，不要继续调用工具

## 反重复规则
工具已返回成功结果时，绝不重复调用相同目标；失败时必须改变策略（换工具、拆分任务、修改方法）。`;
  }

  // ── Tools ────────────────────────────────────────────────────

  /**
   * 将子 Agent 封装为 DynamicTool（对应 createAgent 中 tools 参数 / LangGraph ToolNode 概念）。
   * 同时追加 ask_user 工具处理 WaitForUser 场景。
   */
  private createTools(callback: IAgentCallback): DynamicTool[] {
    const { onMessage: _, ...subCallback } = callback;

    const subAgentTools = this.agentSubNodes.map(node => new DynamicTool({
      name: node.name,
      description: `${node.desc}。输入：完整独立的任务指令，包含所有必要背景和约束。`,
      func: async (task: string) => {
        let agentService: AgentServiceBase | null = null;
        try {
          const subContainer = new ServiceContainer();
          subContainer.registerSingleton(IAgentSaverService, AgentMemorySaver);
          if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
          if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);

          agentService = await this.agentFactory(node.name, subContainer);
          agentService.addSystemPrompts([`你已收到完成任务所需的全部信息。立即调用可用工具执行，禁止提问、禁止请求补充信息、禁止输出建议或说明。对任何不确定之处自行做出合理假设后执行。若任务确实无法完成，直接返回具体错误原因，不得提问。`]);

          const messages = await agentService.stream(task, subCallback);
          const result = messages.map(m => m.content as string).join('');
          return await this.summarizeActionResult(node.name, task, result);
        } catch (error: any) {
          return `执行失败: ${error.message}`;
        } finally {
          await agentService?.dispose();
        }
      },
    }));

    return subAgentTools;
  }

  // ── Summarize ────────────────────────────────────────────────

  private async summarizeActionResult(agentName: string, task: string, actionResult: string): Promise<string> {
    if (actionResult.length <= 200) return actionResult;

    const systemPrompt = `你是执行结果分析器。将 Agent 原始输出提炼为精简的结构化摘要，供 Think 节点据此做出下一步决策。

输出格式（严格按此结构，不添加其他内容）：
**状态**：成功 / 失败 / 部分完成
**关键数据**：执行产出的具体信息——文件路径、ID、数量、名称、URL 等可被后续步骤引用的关键值
**错误原因**：（失败时）准确描述错误类型、发生位置和根本原因；成功时省略此项
**结论**：一句话说明本步骤是否达成预期目标

要求：不复述原始输出，只保留 Think 节点做决策所需的信息，100-300 字。`;

    try {
      const aiMessage = await this.summaryModelService.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`Agent: ${agentName}\n任务: ${task}\n\n执行输出：\n\n${actionResult}\n\n请生成摘要报告。`),
      ]);
      return (aiMessage.content as string).trim() || actionResult;
    } catch (error: any) {
      this.logger?.error(`RESULT: 摘要失败，跳过摘要 - ${error.message}`);
      return actionResult.length > 3000 ? actionResult.substring(0, 3000) + '...(结果已截断)' : actionResult;
    }
  }

  // ── Reflect ──────────────────────────────────────────────────

  private formatMessageHistory(messages: BaseMessage[]): string {
    const lines: string[] = [];
    let step = 0;
    for (const msg of messages) {
      const name = msg.constructor.name;
      const m = msg as any;
      if (name === 'AIMessage' || name === 'AIMessageChunk') {
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            step++;
            lines.push(`步骤 ${step} [Action] 调用 ${tc.name}:\n${tc.args?.input ?? tc.args?.task ?? JSON.stringify(tc.args)}`);
          }
        } else if (m.content) {
          step++;
          lines.push(`步骤 ${step} [Think]:\n${m.content}`);
        }
      } else if (name === 'ToolMessage') {
        step++;
        lines.push(`步骤 ${step} [Result] ${m.name ?? ''}:\n${m.content}`);
      }
    }
    return lines.length === 0 ? "暂无历史步骤" : lines.join('\n\n');
  }

  private async reflect(goal: string, agentMessages: BaseMessage[], callback: IAgentCallback): Promise<string> {
    const systemPrompt = `根据任务执行历史生成最终总结，直接展示给用户。要求：
- 开门见山说明目标是否达成
- 列出完成的主要事项和关键产出（文件名、数量、ID 等具体信息）
- 如有未完成部分，简要说明原因
- 语言自然流畅，不要出现"Action""Agent""步骤 N""观察""迭代"等内部术语`;

    try {
      const aiMessage = await this.reflectModelService.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`## 目标\n${goal}\n\n## 执行过程\n${this.formatMessageHistory(agentMessages)}\n\n请生成最终总结。`),
      ]);
      const reflection = (aiMessage.content as string).trim();
      const chunk = this.convertToMessageChunk(new AIMessage(`✨ **总结**:\n\n${reflection}`));
      if (chunk) await callback.onMessage?.(chunk);
      return reflection;
    } catch (error: any) {
      this.logger?.error(`REFLECT: 反思失败 - ${error.message}`);
      const msg = `任务执行完成，但生成总结时出错：${error.message}`;
      const chunk = this.convertToMessageChunk(new AIMessage(msg));
      if (chunk) await callback.onMessage?.(chunk);
      return msg;
    }
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * 手写 ReAct 循环，对照 createAgent / ReactAgent 内部的图结构：
   *
   *   START → [agent 节点] → (有 tool_calls?) → [tools 节点] → [agent 节点] → ...
   *                                           ↘ (无 tool_calls) → END
   *
   * agent 节点：model.bindTools(tools).stream(messages)，流式输出给 callback
   * tools 节点：逐个调用工具，将 ToolMessage 追加到消息列表
   */
  async stream(query: string, callback: IAgentCallback): Promise<BaseMessage[]> {
    this.logger?.info(`ReAct 开始 | 用户: ${this.saverService.threadId} | Agents: [${this.agentSubNodes.map(r => r.name).join(', ')}] | 最大迭代: ${this.maxIterations} | 查询: ${query.substring(0, 80)}`);

    const history = await this.saverService.getMessages(MAX_HISTORY_TOKENS);
    const tools = this.createTools(callback);
    const toolMap = new Map(tools.map(t => [t.name, t]));

    // 对应 createAgent 中 model.bindTools(tools) — 让模型感知工具并输出 tool_calls
    const modelWithTools = this.thinkModelService.bindTools(tools);
    const systemMsg = new SystemMessage(this.buildThinkSystemPrompt());

    const allMessages: BaseMessage[] = [];
    // chatMessages 不含 system prompt（由 bindTools 模型单独接收），与 createAgent 行为一致
    const chatMessages: BaseMessage[] = [...history, new HumanMessage(query)];

    for (let i = 0; i < this.maxIterations; i++) {
      // ── Agent 节点：流式调用 LLM ──────────────────────────────
      const chunks: AIMessageChunk[] = [];
      try {
        const modelStream = await modelWithTools.stream([systemMsg, ...chatMessages]);
        for await (const chunk of modelStream) {
          chunks.push(chunk);
          const agentMsg = this.convertToMessageChunk(chunk);
          if (agentMsg?.content) await callback.onStreamMessage?.(agentMsg);
        }
      } catch (error: any) {
        this.logger?.error(`Agent 节点调用失败 (第 ${i + 1} 轮): ${error.message}`);
        break;
      }

      if (chunks.length === 0) break;

      // 合并流式 chunks → 完整 AIMessage（tool_calls 在此合并）
      const aiMsg = chunks.reduce((a, b) => a.concat(b)) as unknown as AIMessage;
      chatMessages.push(aiMsg);
      allMessages.push(aiMsg);

      const aiAgentMsg = this.convertToMessageChunk(aiMsg);
      if (aiAgentMsg) await callback.onMessage?.(aiAgentMsg);

      // ── 条件边：无 tool_calls → 结束循环（对应 createAgent 的 shouldContinue 逻辑）
      if (!aiMsg.tool_calls?.length) break;

      // ── Tools 节点：执行所有工具调用 ─────────────────────────
      for (const tc of aiMsg.tool_calls) {
        const tool = toolMap.get(tc.name);
        let content: string;
        try {
          const input: string = tc.args?.input ?? tc.args?.task ?? JSON.stringify(tc.args);
          content = tool
            ? await tool.func(input)
            : `未找到工具: ${tc.name}，可用工具: [${[...toolMap.keys()].join(', ')}]`;
        } catch (e: any) {
          content = `工具 ${tc.name} 执行失败: ${e.message}`;
        }

        const toolMsg = new ToolMessage({ content, tool_call_id: tc.id ?? '' });
        chatMessages.push(toolMsg);
        allMessages.push(toolMsg);
        const toolAgentMsg = this.convertToMessageChunk(toolMsg);
        if (toolAgentMsg) await callback.onMessage?.(toolAgentMsg);
      }
    }

    const reflectResult = await this.reflect(query, allMessages, callback);

    if (this.memoryService && reflectResult) {
      try {
        await this.memoryService.memorizeConversation(query, [reflectResult]);
      } catch (error: any) {
        this.logger?.warn(`保存记忆失败: ${error.message}`);
      }
    }

    if (reflectResult) {
      try {
        await this.saverService.pushMessage(new HumanMessage(query));
        await this.saverService.pushMessage(new AIMessage(reflectResult));
      } catch (error: any) {
        this.logger?.warn(`保存对话到 saver 失败: ${error.message}`);
      }
    }

    return reflectResult ? [new AIMessage(reflectResult)] : [];
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await this.thinkModelService?.dispose();
    await this.summaryModelService?.dispose();
    await this.reflectModelService?.dispose();
  }
}
