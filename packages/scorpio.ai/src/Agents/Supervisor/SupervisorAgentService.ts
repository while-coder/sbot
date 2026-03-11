import { HumanMessage, AIMessage, BaseMessage, SystemMessage } from "langchain";
import { StateGraph, START, END } from '../../Graph';
import { inject, ServiceContainer } from "../../Core";
import { IMemoryService, ReadOnlyMemoryService } from "../../Memory";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { AgentServiceBase, IAgentCallback, AgentSubNode, CreateAgentFn, T_CreateAgent, T_SummaryModelService, MAX_HISTORY_TOKENS } from "../AgentServiceBase";
import { AgentMemorySaver } from "../../Saver/AgentMemorySaver";

// ── Tokens ────────────────────────────────────────────────────

export const T_SupervisorSubNodes = Symbol("scorpio:T_SupervisorSubNodes");
export const T_SupervisorMaxRounds = Symbol("scorpio:T_SupervisorMaxRounds");
export const T_SupervisorAgentName = Symbol("scorpio:T_SupervisorAgentName");
export const T_FinalizeModelService = Symbol("scorpio:T_FinalizeModelService");

// ── Types ─────────────────────────────────────────────────────

export enum SupervisorNode {
  Supervisor      = "supervisor",        // 决策：分析进展，给出推理
  SupervisorError = "supervisor_error",  // 决策错误，重新规划
  Workers         = "workers",           // 本轮待执行 Worker 列表
  Result          = "result",            // 单个 Worker 执行结果
  WaitForUser     = "wait_for_user",     // 等待用户补充信息
  Finalize        = "finalize",          // 完成总结
}

export interface WorkerAssignment {
  name: string;
  goal: string;
  task: string;
  systemPrompt?: string;
}

export interface SupervisorStep {
  type: SupervisorNode;
  content: string;
}

export interface SupervisorState {
  goal: string;
  steps: SupervisorStep[];
  currentWorkers: WorkerAssignment[];
  maxRounds: number;
  currentRound: number;
  finalResult?: string;
}

type GraphState = { messages: BaseMessage[]; supervisorState: SupervisorState | null; callback: IAgentCallback | null };


// ── SupervisorAgentService ────────────────────────────────────

/**
 * Supervisor Agent 服务，实现中心化调度的多 Agent 协同。
 *
 * 循环：Supervisor → Workers → Supervisor → ... → Finalize
 *
 * Supervisor 每轮返回计划执行的 Worker 列表，Workers 节点顺序执行全部 Worker，
 * 完成后经 fixed edge 回到 Supervisor 重新评估。
 *
 * 通过 createAgent 回调创建 Worker Agent，解耦对 AgentFactory / userInfo 的直接依赖。
 */
export class SupervisorAgentService extends AgentServiceBase {
  private supervisorAgentName: string;
  private finalizeModelService: IModelService;
  private summaryModelService: IModelService;
  private agentSubNodes: AgentSubNode[];
  private createAgent: CreateAgentFn;
  private maxRounds: number;

  constructor(
    @inject(T_SupervisorAgentName) supervisorAgentName: string,
    @inject(T_FinalizeModelService) finalizeModelService: IModelService,
    @inject(T_SummaryModelService) summaryModelService: IModelService,
    @inject(T_SupervisorSubNodes) agentSubNodes: AgentSubNode[],
    @inject(T_CreateAgent) createAgent: CreateAgentFn,
    @inject(T_SupervisorMaxRounds, { optional: true }) maxRounds?: number,
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    super(loggerService, agentSaver, memoryService);
    this.supervisorAgentName = supervisorAgentName;
    this.finalizeModelService = finalizeModelService;
    this.summaryModelService = summaryModelService;
    this.agentSubNodes = agentSubNodes;
    this.createAgent = createAgent;
    this.maxRounds = maxRounds ?? 10;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private formatStepHistory(steps: SupervisorStep[]): string {
    if (steps.length === 0) return "暂无历史步骤";
    return steps.map((step, i) => {
      const prefix = `步骤 ${i + 1} [${step.type}]`;
      switch (step.type) {
        case SupervisorNode.Supervisor:      return `${prefix} 决策:\n${step.content}`;
        case SupervisorNode.SupervisorError: return `${prefix} 决策错误:\n${step.content}`;
        case SupervisorNode.Result:          return `${prefix} 执行结果:\n${step.content}`;
        case SupervisorNode.WaitForUser:     return `${prefix} 等待用户:\n${step.content}`;
        case SupervisorNode.Finalize:        return `${prefix} 完成:\n${step.content}`;
      }
    }).filter(Boolean).join('\n\n');
  }

  private parseJsonResponse(content: string): any {
    const stripped = content.trim().replace(/^```json\s*|^```\s*|```\s*$/gm, '');
    return JSON.parse(stripped.trim());
  }

  private addStep(supervisorState: SupervisorState, type: SupervisorNode, content: string) {
    this.logger?.info(`添加步骤: ${type}: ${content}`)
    supervisorState.steps.push({ type, content });
  }

  // ── Node Functions ───────────────────────────────────────────

  private async supervisorNode(state: GraphState) {
    const supervisorState = state.supervisorState!;

    if (supervisorState.currentRound >= supervisorState.maxRounds) {
      this.addStep(supervisorState, SupervisorNode.Finalize, `已达最大迭代次数 ${supervisorState.maxRounds}，强制完成`);
      return { supervisorState };
    }

    const agentsDesc = this.agentSubNodes.map(a => `- ${a.name}: ${a.desc}`).join('\n');
    const workerNameList = this.agentSubNodes.map(a => a.name).join('/');

    const systemPrompt = `你是多 Agent 协作的 Supervisor，负责分析任务进展并调度 Worker 执行。

## 工作流程
1. **信息收集（可选）**：若需要了解 Worker 能力、读取项目文件或查阅 Skill 说明，先调用工具收集信息
2. **分析决策**：基于执行历史和收集到的信息，评估当前进展并规划下一批任务
3. **输出决策**：所有工具调用完成后，最终回复必须且仅是以下格式的纯 JSON，不包含任何其他文字

## 可用 Worker Agents
${agentsDesc}

## 最终输出格式（纯 JSON，不加 markdown 代码块）
{
  "thought": "分析：上一步 Worker 结果是否符合预期（若有）、当前目标完成程度、下一步应分配哪些 Worker 及原因",
  "decision": "${SupervisorNode.Workers} | ${SupervisorNode.Finalize} | ${SupervisorNode.WaitForUser}",
  "workers": [
    {
      "name": "${workerNameList}",
      "goal": "该 Worker 本次的任务目标（一句话概括）",
      "task": "完整独立的任务指令，包含所有必要上下文，Worker 无需查阅历史记录即可直接执行",
      "systemPrompt": "（可选）对该 Worker 的特殊约束，如角色定位、输出格式、语言要求、领域限制等"
    }
  ],
  "waitMessage": "用 Markdown 向用户提问，清晰说明需要用户决策的内容"
}

## 决策标准
- **${SupervisorNode.Workers}**：需要 Worker 处理 → 必须填写 workers（name / goal / task）
- **${SupervisorNode.Finalize}**：所有目标已完成，且有 Result 明确确认成功
- **${SupervisorNode.WaitForUser}**：用户必须亲自做出选择才能继续 → 必须填写 waitMessage

## WaitForUser 使用限制（重要）
只有满足以下全部条件才可使用 WaitForUser：
1. 存在需要用户**主观决策**的分叉点，例如：选择实现方案、决定业务逻辑走向
2. 该决策无法由 Supervisor 或 Worker 代为推断或假设
3. 不做该决策则任务无法继续推进

**禁止**使用 WaitForUser 的情形：
- 任务意图模糊或信息不完整 → 应基于已有信息做出合理假设，派发 Workers 继续执行
- Supervisor 自身能分析出下一步 → 直接派发 Workers，不打扰用户
- 只是想向用户确认或汇报进展 → 选择 Workers 或 Finalize

## 执行约束
- 可同时派发多个 Worker 顺序执行（互不依赖的子任务），也可只派发一个
- name 必须是上方列出的 Worker 名称之一
- task 必须自包含：包含背景、目标、约束，Worker 无需参考任何历史上下文即可独立执行
- Worker 结果失败时：分析根本原因，调整策略后重试，不要直接跳到 Finalize
- 已成功完成的任务禁止重复派发`;

    const humanPrompt = `## 目标
${supervisorState.goal}

## 执行历史（第 ${supervisorState.currentRound + 1} / ${supervisorState.maxRounds} 轮）
${this.formatStepHistory(supervisorState.steps)}

请分析以上进展并返回决策。`;

    try {
      supervisorState.currentRound += 1;
      
      const supervisorSaver = new AgentMemorySaver();
      if (this.saverService) {
        for (const msg of await this.saverService.getMessages(MAX_HISTORY_TOKENS))
          await supervisorSaver.pushMessage(msg);
      }
      const subContainer = new ServiceContainer();
      subContainer.registerInstance(IAgentSaverService, supervisorSaver);
      if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);
      if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
      const supervisorAgent = await this.createAgent(this.supervisorAgentName, subContainer);
      supervisorAgent.addSystemPrompts([systemPrompt]);
      const supervisorMessages = await supervisorAgent.invoke(humanPrompt);
      await supervisorAgent.dispose();
      const aiMessages = supervisorMessages.filter(m => m instanceof AIMessage);
      const decision = this.parseJsonResponse(aiMessages[aiMessages.length - 1]?.content as string ?? '');
      this.addStep(supervisorState, SupervisorNode.Supervisor, decision.thought);
      const decisionType: SupervisorNode = decision.decision;
      if (decision.decision === SupervisorNode.Finalize) {
        this.addStep(supervisorState, SupervisorNode.Finalize, "任务已完成");
      } else if (decisionType == SupervisorNode.Workers) {
        const available = this.agentSubNodes.map(a => a.name);
        const rawWorkers: WorkerAssignment[] = Array.isArray(decision.workers) ? decision.workers : [];
        const invalid = rawWorkers.filter(w => !w.name || !w.task || !available.includes(w.name));
        if (invalid.length > 0)
          throw new Error(`无效的 Worker 名称: [${invalid.map(w => w.name ?? '(空)').join(', ')}]，可用列表: [${available.join(', ')}]`);
        supervisorState.currentWorkers = rawWorkers;
        this.addStep(supervisorState, SupervisorNode.Workers, rawWorkers.map(w => w.name).join(', '));
      } else if (decisionType === SupervisorNode.WaitForUser) {
        const waitMsg = decision.waitMessage || decision.thought;
        const defaultReply = "请根据已有信息继续执行，做出合理判断。";
        this.addStep(supervisorState, SupervisorNode.WaitForUser, `**待用户确认信息**\n${waitMsg}\n**用户回复**\n${defaultReply}`);
      } else {
        throw new Error(`无效的 decisionType: ${decisionType}`);
      }
      return { supervisorState };
    } catch (error: any) {
      this.addStep(supervisorState, SupervisorNode.SupervisorError, `SUPERVISOR: 决策失败 - ${error.message}`);
      return { supervisorState };
    }
  }

  private routeAfterSupervisor(state: GraphState): string {
    const supervisorState = state.supervisorState!;
    const lastStep = supervisorState.steps[supervisorState.steps.length - 1];
    if (lastStep.type === SupervisorNode.Finalize) {
      return SupervisorNode.Finalize;
    } else if (lastStep.type === SupervisorNode.SupervisorError) {
      return SupervisorNode.Supervisor;
    } else if (lastStep.type === SupervisorNode.Workers) {
      return SupervisorNode.Workers;
    } else if (lastStep.type === SupervisorNode.WaitForUser) {
      return SupervisorNode.Supervisor;
    } else {
      this.logger?.error(`SUPERVISOR: 无法处理步骤类型 - ${lastStep.type}`);
    }
    return SupervisorNode.Supervisor;
  }
  private async summarizeWorkerResult(agentName: string, task: string, workerResult: string): Promise<string> {
    const summarizeThreshold = 200;
    if (workerResult.length <= summarizeThreshold) return workerResult;

    const systemPrompt = `你是执行结果分析器。将 Worker Agent 原始输出提炼为精简的结构化摘要，供 Supervisor 据此做出下一步决策。

输出格式（严格按此结构，不添加其他内容）：
**状态**：成功 / 失败 / 部分完成
**关键数据**：执行产出的具体信息——文件路径、ID、数量、名称、URL 等可被后续步骤引用的关键值
**错误原因**：（失败时）准确描述错误类型、发生位置和根本原因；成功时省略此项
**结论**：一句话说明本步骤是否达成预期目标

要求：不复述原始输出，只保留 Supervisor 做决策所需的信息，100-300 字。`;

    const humanPrompt = `Worker: ${agentName}\n任务: ${task}\n\n执行输出：\n\n${workerResult}\n\n请生成摘要报告。`;

    try {
      const aiMessage = await this.summaryModelService.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt),
      ]);
      return (aiMessage.content as string).trim() || workerResult;
    } catch (error: any) {
      this.logger?.error(`RESULT: 摘要失败，跳过摘要 - ${error.message}`);
      return workerResult.length > 3000 ? workerResult.substring(0, 3000) + '...(结果已截断)' : workerResult;
    }
  }
  private async workersNode(state: GraphState) {
    const { onMessage: _, ...subCallback } = state.callback ?? {};
    const supervisorState = state.supervisorState!;
    const workers = supervisorState.currentWorkers;
    const total = workers.length;

    for (let i = 0; i < total; i++) {
      const worker = workers[i];
      let agentService: AgentServiceBase | null = null;
      try {
        this.logger?.info(`WORKER: ${worker.name} - ${worker.task}`);
        const subContainer = new ServiceContainer();
        subContainer.registerSingleton(IAgentSaverService, AgentMemorySaver);
        if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
        if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);
        agentService = await this.createAgent(worker.name, subContainer);
        agentService.addSystemPrompts([`你已收到完成任务所需的全部信息。立即调用可用工具执行，禁止提问、禁止请求补充信息、禁止输出建议或说明。对任何不确定之处自行做出合理假设后执行。若任务确实无法完成，直接返回具体错误原因，不得提问。`]);
        if (worker.systemPrompt) agentService.addSystemPrompts([worker.systemPrompt]);
        const messages = await agentService.stream(worker.task, { ...subCallback });
        const workerResult = messages.map(m => m.content as string).join('');
        const observed = await this.summarizeWorkerResult(worker.name, worker.task, workerResult);
        this.addStep(supervisorState, SupervisorNode.Result, `[${worker.name}] 目标: ${worker.goal}\n返回结果:\n${observed}`);
      } catch (error: any) {
        this.addStep(supervisorState, SupervisorNode.Result, `[${worker.name}] 目标: ${worker.goal}\n执行失败:\n${error.message}`);
      } finally {
        await agentService?.dispose();
      }
    }
    supervisorState.currentWorkers = [];
    return { supervisorState };
  }

  private async finalizeNode(state: GraphState) {
    const supervisorState = state.supervisorState!;

    const systemPrompt = `根据任务执行历史生成最终总结，直接展示给用户。要求：
- 开门见山说明目标是否达成
- 列出完成的主要事项和关键产出（文件名、数量、ID 等具体信息）
- 如有未完成部分，简要说明原因
- 语言自然流畅，不要出现"Worker""Supervisor""轮次""步骤 N""调度"等内部术语`;

    const humanPrompt = `## 目标
${supervisorState.goal}

## 执行过程
${this.formatStepHistory(supervisorState.steps)}

请生成最终总结。`;
    try {
      const aiMessage = await this.finalizeModelService.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanPrompt),
      ]);
      const summary = (aiMessage.content as string).trim();
      supervisorState.finalResult = summary;
      return { supervisorState, messages: [new AIMessage(`✨ **总结**:\n\n${summary}`)] };
    } catch (error: any) {
      this.logger?.error(`FINALIZE: 总结失败 - ${error.message}`);
      return { supervisorState, messages: [new AIMessage(`任务执行完成，但生成总结时出错：${error.message}`)] };
    }
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await this.finalizeModelService?.dispose();
    await this.summaryModelService?.dispose();
  }

  // ── Graph ────────────────────────────────────────────────────

  private createGraph() {
    return new StateGraph<GraphState>()
      .addNode(SupervisorNode.Supervisor, this.supervisorNode.bind(this))
      .addNode(SupervisorNode.Workers, this.workersNode.bind(this))
      .addNode(SupervisorNode.Finalize, this.finalizeNode.bind(this))
      .addEdge(START, SupervisorNode.Supervisor)
      .addConditionalEdges(SupervisorNode.Supervisor, this.routeAfterSupervisor.bind(this))
      .addEdge(SupervisorNode.Workers, SupervisorNode.Supervisor)
      .addEdge(SupervisorNode.Finalize, END);
  }

  // ── Public API ───────────────────────────────────────────────

  async stream(query: string, callback: IAgentCallback): Promise<BaseMessage[]> {
    try {
      const graph = this.createGraph();

      this.logger?.info(`Supervisor 开始 | 用户: ${this.saverService.threadId} | Workers: [${this.agentSubNodes.map(r => r.name).join(', ')}] | 最大轮次: ${this.maxRounds} | 查询: ${query.substring(0, 80)}`);

      const graphStream = graph.stream(
        {
          messages: [],
          supervisorState: {
            goal: query,
            steps: [],
            currentWorkers: [],
            maxRounds: this.maxRounds,
            currentRound: 0,
          } as SupervisorState,
          callback,
        },
      );

      const { onMessage } = callback;
      let finalSupervisorState: SupervisorState | null = null;
      const outputMessages: BaseMessage[] = [];

      for await (const update of graphStream) {
        for (const nodeOutput of Object.values(update)) {
          const output = nodeOutput as any;
          if (output.supervisorState) finalSupervisorState = output.supervisorState;
          for (const message of output.messages ?? []) {
            if (message instanceof HumanMessage) continue;
            const chunk = this.convertToMessageChunk(message);
            if (chunk) await onMessage?.(chunk);
          }
        }
      }

      const finalResult = finalSupervisorState?.finalResult ?? '';

      if (finalResult) {
        outputMessages.push(new AIMessage(finalResult));
      }

      if (this.memoryService && finalResult) {
        try {
          await this.memoryService.memorizeConversation(query, [finalResult]);
        } catch (error: any) {
          this.logger?.warn(`保存记忆失败: ${error.message}`);
        }
      }

      if (this.saverService && finalResult) {
        try {
          await this.saverService.pushMessage(new HumanMessage(query));
          await this.saverService.pushMessage(new AIMessage(finalResult));
        } catch (error: any) {
          this.logger?.warn(`保存对话到 saver 失败: ${error.message}`);
        }
      }

      this.logger?.info("Supervisor 完成");
      return outputMessages;
    } catch (error: any) {
      this.logger?.error(`Supervisor 失败 - ${error.message}`);
      throw error;
    }
  }
}
