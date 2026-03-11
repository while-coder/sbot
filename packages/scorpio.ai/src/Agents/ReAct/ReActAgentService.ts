import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "langchain";
import { StateGraph, START, END } from '../../Graph';
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
export const T_ThinkAgentName = Symbol("scorpio:T_ThinkAgentName");
export const T_ReflectModelService = Symbol("scorpio:T_ReflectModelService");

export enum ReActNode {
  Think = "think",                  // 推理下一步行动
  ThinkError = "think_error",       // 推理错误，需要重新思考
  WaitForUser = "wait_for_user",    // 等待用户输入
  Action = "action",                // 执行动作
  Result = "result",                // 记录动作执行结果
  Reflect = "reflect",              // 反思
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

export interface ReActState {
  goal: string;
  steps: ReActStep[];
  currentAction: ReActAction | null;
  maxIterations: number;
  currentIteration: number;
  finalResult?: string;
}

type GraphState = { messages: BaseMessage[]; reactState: ReActState | null; callback: IAgentCallback | null };


// ── ReActAgentService ─────────────────────────────────────────

/**
 * ReAct Agent 服务，实现 Reasoning and Acting 模式的多 Agent 协同。
 *
 * 循环：Think → Agent → Result → Think → ... → Reflect
 *   短输出直接存为 Result；长输出由 LLM 提炼后存为 Result。原始输出见 logger。
 *
 * 通过 createAgent 回调创建子 Agent，解耦对 AgentFactory / userInfo 的直接依赖。
 * Think 节点使用 T_ThinkModelService；Reflect 节点使用 T_ReflectModelService。
 */
export class ReActAgentService extends AgentServiceBase {
  private thinkAgentName: string;
  private reflectModelService: IModelService;
  private summaryModelService: IModelService;
  private agentSubNodes: AgentSubNode[];
  private createAgent: CreateAgentFn;
  private maxIterations: number;

  constructor(
    @inject(T_ThinkAgentName) thinkAgentName: string,
    @inject(T_ReflectModelService) reflectModelService: IModelService,
    @inject(T_SummaryModelService) summaryModelService: IModelService,
    @inject(T_AgentSubNodes) agentSubNodes: AgentSubNode[],
    @inject(T_CreateAgent) createAgent: CreateAgentFn,
    @inject(T_MaxIterations, { optional: true }) maxIterations?: number,
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    super(loggerService, agentSaver, memoryService);
    this.agentSubNodes = agentSubNodes;
    this.maxIterations = maxIterations ?? 5;
    this.thinkAgentName = thinkAgentName;
    this.reflectModelService = reflectModelService;
    this.summaryModelService = summaryModelService;
    this.createAgent = createAgent;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private formatStepHistory(steps: ReActStep[]): string {
    if (steps.length === 0) return "暂无历史步骤";
    const lines: string[] = [];
    let num = 0;
    for (const step of steps) {
      let label: string | null = null;
      switch (step.type) {
        case ReActNode.Think:       label = '思考'; break;
        case ReActNode.ThinkError:  label = '推理出错'; break;
        case ReActNode.Result:      label = '执行结果'; break;
        case ReActNode.Reflect:     label = '反思'; break;
        case ReActNode.WaitForUser: label = '等待用户'; break;
      }
      if (label === null) continue;
      num++;
      lines.push(`步骤 ${num} [${step.type}] ${label}:\n${step.content}`);
    }
    return lines.length === 0 ? "暂无历史步骤" : lines.join('\n\n');
  }

  private parseJsonResponse(content: string): any {
    try {
      const stripped = content.trim().replace(/^```json\s*|^```\s*|```\s*$/gm, '');
      return JSON.parse(stripped.trim());
    } catch (e) {
      throw new Error(`无法解析 JSON: ${content}`);
    }
  }

  private addStep(reactState: ReActState, type: ReActNode, content: string) {
    this.logger?.info(`添加步骤: ${type}: ${content}`)
    reactState.steps.push({ type, content });
  }

  private resolveAgentId(agentName: string | undefined, available: string[]): string | undefined {
    if (agentName && available.includes(agentName))
      return agentName;
    throw new Error(`无效的 agentName: ${agentName}, 可用列表: [${available.join(', ')}]`);
  }

  // ── Node Functions ───────────────────────────────────────────

  /**
   * THINK 节点：推理下一步行动。
   * 当决策为 wait_for_user 时，直接 await callback.askUser()，
   * graph stream 在此暂停等待用户回答，无需中断重启。
   */
  private async thinkNode(state: GraphState) {
    const { onMessage: _, ...subCallback } = state.callback ?? {};
    const reactState = state.reactState!;

    if (reactState.currentIteration >= reactState.maxIterations) {
      this.addStep(reactState, ReActNode.Reflect, `已达最大迭代次数 ${reactState.maxIterations}，强制完成`)
      return { reactState };
    }
    const agentsDesc = this.agentSubNodes.map(a => `- ${a.name}: ${a.desc}`).join('\n');
    const agentNameList = this.agentSubNodes.map(a => a.name).join('/');

    const systemPrompt = `你是 ReAct 编排专家，负责分析任务进展并决定下一步行动。

## 可用 Agent
${agentsDesc}

## 工作流程
1. **信息收集（可选）**：若需要了解 Agent 能力、读取项目文件或查阅 Skill 说明，先调用工具
2. **分析决策**：基于执行历史和收集到的信息，分析当前进展
3. **输出决策**：所有工具调用完成后，最终回复必须且仅是以下格式的纯 JSON，不包含任何其他文字

## 最终输出格式（纯 JSON，不加 markdown 代码块）
{
  "thought": "分析：上一步是否成功（若有）、当前目标完成程度、下一步应做什么及原因",
  "decision": "${ReActNode.Reflect} | ${ReActNode.Action} | ${ReActNode.WaitForUser}",
  "nextAction": {
    "agentName": "${agentNameList}",
    "goal": "本次 Action 的任务目标（一句话概括）",
    "task": "完整独立的任务指令，包含所有必要上下文，Agent 无需查阅历史记录即可直接执行",
    "systemPrompt": "（可选）对该 Agent 的特殊约束，如角色定位、输出格式、语言要求、领域限制等"
  },
  "waitMessage": "用 Markdown 向用户提问，清晰说明缺少哪些信息及其必要性"
}

## 决策标准
- **${ReActNode.Reflect}**：任务目标已完全达成，且有 Result 明确确认成功
- **${ReActNode.Action}**：需要调用 Agent → 必须填写 nextAction（agentName / goal / task）
- **${ReActNode.WaitForUser}**：用户必须亲自做出选择才能继续 → 必须填写 waitMessage

## 反重复规则（强制执行）
填写 decision 前，在执行历史中找出所有 [result] 步骤，检查：
- nextAction.agentName + nextAction.goal 与已有 result 中某项**相同或高度相似**时：
  - 该项已成功 → decision 必须为 **${ReActNode.Reflect}**，任务已完成
  - 该项已失败 → 必须改变策略（换 agent、拆分任务、修改方法），task 须与上次不同
- 禁止连续两次派遣同一 agent 执行相同或相似目标

## WaitForUser 使用限制
只有满足以下全部条件才可使用 WaitForUser：
1. 存在需要用户**主观决策**的分叉点（如选择实现方案、决定业务逻辑走向）
2. 该决策无法由编排专家或 Agent 代为推断或假设
3. 不做该决策则任务无法继续推进

**禁止**使用 WaitForUser 的情形：
- 任务意图模糊或信息不完整 → 应基于已有信息做出合理假设，选择 Action 继续执行
- 编排专家自身能分析出下一步 → 直接 Action，不打扰用户
- 只是想向用户确认或汇报进展 → 选择 Action 或 Reflect

## 执行约束
- 每次只规划一个 Action，agentName 必须是上方列表中的名称之一
- task 必须自包含：包含背景、目标、约束，Agent 无需参考任何历史上下文即可独立执行
- Result 显示失败时：分析根本原因，调整策略后重试，不要直接跳到 Reflect`;

    const humanPrompt = `## 目标
${reactState.goal}

## 执行历史（第 ${reactState.currentIteration + 1} / ${reactState.maxIterations} 轮）
${this.formatStepHistory(reactState.steps)}

请分析以上进展，返回 JSON 决策。`;

    try {
      reactState.currentIteration += 1;
      const thinkSaver = new AgentMemorySaver();
      if (this.saverService) {
        for (const msg of await this.saverService.getMessages(MAX_HISTORY_TOKENS))
          await thinkSaver.pushMessage(msg);
      }
      await thinkSaver.pushMessage(new HumanMessage(reactState.goal));
      const subContainer = new ServiceContainer();
      subContainer.registerInstance(IAgentSaverService, thinkSaver);
      if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);
      if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
      const thinkAgent = await this.createAgent(this.thinkAgentName, subContainer);
      thinkAgent.addSystemPrompts([systemPrompt]);
      this.logger?.info(humanPrompt)
      const thinkMessages = await thinkAgent.stream(humanPrompt, { ...subCallback });
      await thinkAgent.dispose();

      const aiMessages = thinkMessages.filter(m => m instanceof AIMessage);
      const lastAIMessage = aiMessages[aiMessages.length - 1];
      const decision = this.parseJsonResponse(lastAIMessage?.content as string ?? '');
      this.addStep(reactState, ReActNode.Think, decision.thought);
      const decisionType: ReActNode = decision.decision;
      if (decisionType === ReActNode.Reflect) {
        this.addStep(reactState, ReActNode.Reflect, "任务已完成，结束规划");
      } else if (decisionType === ReActNode.WaitForUser) {
        const waitMsg = decision.waitMessage || decision.thought;
        const defaultReply = "请根据已有信息继续执行，做出合理判断。";
        this.addStep(reactState, ReActNode.WaitForUser, `**待用户确认信息**\n${waitMsg}\n**用户回复**\n${defaultReply}`);
      } else if (decisionType === ReActNode.Action) {
        const agentName = this.resolveAgentId(decision.nextAction.agentName, this.agentSubNodes.map(a => a.name));
        reactState.currentAction = {
          agentName: agentName!,
          goal: decision.nextAction.goal,
          task: decision.nextAction.task,
          systemPrompt: decision.nextAction.systemPrompt || undefined,
        };
        this.addStep(reactState, ReActNode.Action, `${agentName} - ${decision.nextAction.task}`);
      } else {
        throw new Error(`无效的 decisionType: ${decisionType}`);
      }
      return { reactState };
    } catch (error: any) {
      this.addStep(reactState, ReActNode.ThinkError, `THINK: 推理失败 - ${error.message}`);
      return { reactState };
    }
  }

  private routeAfterThink(state: GraphState): string {
    const reactState = state.reactState!;
    const lastStep = reactState.steps[reactState.steps.length - 1];
    if (lastStep.type == ReActNode.Reflect) {
      return ReActNode.Reflect;
    } else if (lastStep.type == ReActNode.ThinkError) {
      return ReActNode.Think;
    } else if (lastStep.type === ReActNode.Action) {
      return ReActNode.Action;
    } else if (lastStep.type === ReActNode.WaitForUser) {
      return ReActNode.Think;
    } else {
      this.logger?.error(`THINK: 无法处理步骤类型 ${lastStep.type}`);
    }
    return ReActNode.Think;
  }

  private async reflectNode(state: GraphState) {
    const reactState = state.reactState!;

    const systemPrompt = `根据任务执行历史生成最终总结，直接展示给用户。要求：
- 开门见山说明目标是否达成
- 列出完成的主要事项和关键产出（文件名、数量、ID 等具体信息）
- 如有未完成部分，简要说明原因
- 语言自然流畅，不要出现"Action""Agent""步骤 N""观察""迭代"等内部术语`;

    const humanPrompt = `## 目标
${reactState.goal}

## 执行过程
${this.formatStepHistory(reactState.steps)}

请生成最终总结。`;

    try {
      const aiMessage = await this.reflectModelService.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt),
      ]);
      const reflection = (aiMessage.content as string).trim();
      reactState.finalResult = reflection;
      return { reactState, messages: [new AIMessage(`✨ **总结**:\n\n${reflection}`)] };
    } catch (error: any) {
      this.logger?.error(`REFLECT: 反思失败 - ${error.message}`);
      return { reactState, messages: [new AIMessage(`任务执行完成，但生成总结时出错：${error.message}`)] };
    }
  }

  async dispose(): Promise<void> {
    await super.dispose();
    await this.summaryModelService?.dispose();
    await this.reflectModelService?.dispose();
  }

  // ── Graph ────────────────────────────────────────────────────
  private async summarizeActionResult(agentName: string, task: string, actionResult: string): Promise<string> {
    const summarizeThreshold = 200;
    if (actionResult.length <= summarizeThreshold) return actionResult;

    const systemPrompt = `你是执行结果分析器。将 Agent 原始输出提炼为精简的结构化摘要，供 Think 节点据此做出下一步决策。

输出格式（严格按此结构，不添加其他内容）：
**状态**：成功 / 失败 / 部分完成
**关键数据**：执行产出的具体信息——文件路径、ID、数量、名称、URL 等可被后续步骤引用的关键值
**错误原因**：（失败时）准确描述错误类型、发生位置和根本原因；成功时省略此项
**结论**：一句话说明本步骤是否达成预期目标

要求：不复述原始输出，只保留 Think 节点做决策所需的信息，100-300 字。`;

    const humanPrompt = `Agent: ${agentName}\n任务: ${task}\n\n执行输出：\n\n${actionResult}\n\n请生成摘要报告。`;

    try {
      const aiMessage = await this.summaryModelService.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt),
      ]);
      return (aiMessage.content as string).trim() || actionResult;
    } catch (error: any) {
      this.logger?.error(`RESULT: 摘要失败，跳过摘要 - ${error.message}`);
      return actionResult.length > 3000 ? actionResult.substring(0, 3000) + '...(结果已截断)' : actionResult;
    }
  }
  private async actionNode(state: GraphState) {
    const { onMessage: _, ...subCallback } = state.callback ?? {};
    const reactState = state.reactState!;
    const action = reactState.currentAction!;
    let agentService: AgentServiceBase | null = null;
    try {
      const subContainer = new ServiceContainer();
      subContainer.registerSingleton(IAgentSaverService, AgentMemorySaver)
      if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
      if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);
      agentService = await this.createAgent(action.agentName, subContainer);
      agentService.addSystemPrompts([`你已收到完成任务所需的全部信息。立即调用可用工具执行，禁止提问、禁止请求补充信息、禁止输出建议或说明。对任何不确定之处自行做出合理假设后执行。若任务确实无法完成，直接返回具体错误原因，不得提问。`]);
      if (action.systemPrompt) agentService.addSystemPrompts([action.systemPrompt]);
      const messages = await agentService.stream(action.task, { ...subCallback });
      const actionResult = messages.map(m => m.content as string).join('');
      const observed = await this.summarizeActionResult(action.agentName, action.task, actionResult);
      this.addStep(reactState, ReActNode.Result, `[${action.agentName}] 目标: ${action.goal}\n返回结果:\n${observed}`);
      reactState.currentAction = null;
      return { reactState };
    } catch (error: any) {
      this.addStep(reactState, ReActNode.Result, `[${action.agentName}] 目标: ${action.goal}\n执行失败:\n${error.message}`);
      return { reactState };
    } finally {
      await agentService?.dispose();
    }
  }

  private createGraph() {
    return new StateGraph<GraphState>()
      .addNode(ReActNode.Think, this.thinkNode.bind(this))
      .addNode(ReActNode.Action, this.actionNode.bind(this))
      .addNode(ReActNode.Reflect, this.reflectNode.bind(this))
      .addEdge(START, ReActNode.Think)
      .addConditionalEdges(ReActNode.Think, this.routeAfterThink.bind(this))
      .addEdge(ReActNode.Action, ReActNode.Think)
      .addEdge(ReActNode.Reflect, END);
  }

  // ── Public API ───────────────────────────────────────────────

  async stream(query: string, callback: IAgentCallback): Promise<BaseMessage[]> {
    try {
      const graph = this.createGraph();

      this.logger?.info(`ReAct 开始 | 用户: ${this.saverService.threadId} | Agents: [${this.agentSubNodes.map(r => r.name).join(', ')}] | 最大迭代: ${this.maxIterations} | 查询: ${query.substring(0, 80)}`);

      const graphStream = graph.stream(
        {
          messages: [],
          reactState: {
            goal: query,
            steps: [],
            currentAction: null,
            maxIterations: this.maxIterations,
            currentIteration: 0,
          } as ReActState,
          callback,
        },
      );

      const { onMessage } = callback;
      let finalReactState: ReActState | null = null;
      const outputMessages: BaseMessage[] = [];

      for await (const update of graphStream) {
        for (const nodeOutput of Object.values(update)) {
          const output = nodeOutput as any;
          if (output.reactState) finalReactState = output.reactState;
          for (const message of output.messages ?? []) {
            if (message instanceof HumanMessage) continue;
            const chunk = this.convertToMessageChunk(message);
            if (chunk) await onMessage?.(chunk);
          }
        }
      }

      const reflectResult = finalReactState?.finalResult ?? '';

      if (reflectResult) {
        outputMessages.push(new AIMessage(reflectResult));
      }

      if (this.memoryService && reflectResult) {
        try {
          await this.memoryService.memorizeConversation(query, [reflectResult]);
        } catch (error: any) {
          this.logger?.warn(`保存记忆失败: ${error.message}`);
        }
      }

      if (this.saverService && reflectResult) {
        try {
          await this.saverService.pushMessage(new HumanMessage(query));
          await this.saverService.pushMessage(new AIMessage(reflectResult));
        } catch (error: any) {
          this.logger?.warn(`保存对话到 saver 失败: ${error.message}`);
        }
      }

      return outputMessages;
    } catch (error: any) {
      this.logger?.error(`ReAct 失败 - ${error.message}`);
      throw error;
    }
  }
}
