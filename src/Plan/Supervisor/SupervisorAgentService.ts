import { HumanMessage, AIMessage, AIMessageChunk, BaseMessage, SystemMessage } from "langchain";
import { Annotation, MessagesAnnotation, StateGraph, START, END } from '@langchain/langgraph';
import { AgentNodeConfig, AgentRef, config } from '../../Config.js';
import {
  AgentServiceBase,
  IAgentCallback, MessageChunkType, AgentMessage,
  IMemoryService, IAgentSaverService,
  inject, ServiceContainer, T_SystemPrompts,
} from 'scorpio.ai';
import { LoggerService } from '../../LoggerService.js';
import { v4 as uuidv4 } from 'uuid';

const logger = LoggerService.getLogger("SupervisorAgentService");

// ── Types & Annotation ────────────────────────────────────────

export enum SupervisorNode {
  Supervisor = "supervisor",
  Finalize   = "finalize",
}

export function workerNodeName(agentId: string): string {
  return `worker_${agentId}`;
}

export interface SupervisorState {
  goal: string;
  currentWorker: string | null;
  currentTask: string | null;
  isComplete: boolean;
  maxRounds: number;
  currentRound: number;
}

export const SupervisorAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  supervisorState: Annotation<SupervisorState | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  callback: Annotation<IAgentCallback | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
});

type GraphState = typeof SupervisorAnnotation.State;


// ── ReadOnlyMemoryService ─────────────────────────────────────

class ReadOnlyMemoryService implements IMemoryService {
  constructor(private readonly inner: IMemoryService) {}
  getSystemMessage(query: string, limit?: number) { return this.inner.getSystemMessage(query, limit); }
  getTools() { return this.inner.getTools(); }
  async memorizeConversation() {}
  async compressMemories() { return 0; }
  async clearAll() { return 0; }
  async dispose() {}
}


// ── SupervisorAgentService ────────────────────────────────────

/**
 * Supervisor Agent 服务，实现中心化调度的多 Agent 协同。
 *
 * 循环：Supervisor → Worker → Supervisor → ... → Finalize
 *
 * Supervisor 读取对话历史决定下一个 Worker，或宣布完成（FINISH）。
 * Worker 执行任务后将结果作为 HumanMessage 反馈给 Supervisor。
 */
export class SupervisorAgentService extends AgentServiceBase {
  private agentRefs: AgentRef[];
  private maxRounds: number;
  private supervisorConfig?: AgentNodeConfig;
  private userInfo?: any;
  private agentInfos: { id: string; desc: string }[];

  constructor(
    @inject("agentRefs") agentRefs: AgentRef[],
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject("maxRounds", { optional: true }) maxRounds?: number,
    @inject("supervisorConfig", { optional: true }) supervisorConfig?: AgentNodeConfig,
    @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
    @inject("userInfo", { optional: true }) userInfo?: any,
  ) {
    super(null as any, systemPrompts, undefined, agentSaver, undefined, memoryService);
    this.agentRefs = agentRefs;
    this.maxRounds = maxRounds ?? 10;
    this.supervisorConfig = supervisorConfig;
    this.userInfo = userInfo;
    this.agentInfos = agentRefs.map(ref => ({ id: ref.name, desc: ref.desc }));
  }

  // ── Helpers ─────────────────────────────────────────────────

  private parseJsonResponse(content: string): any {
    const stripped = content.trim().replace(/^```json\s*|^```\s*|```\s*$/gm, '');
    return JSON.parse(stripped.trim());
  }

  // ── Node Functions ───────────────────────────────────────────

  private async supervisorNode(state: GraphState) {
    const supervisorState = state.supervisorState;
    if (!supervisorState) {
      logger.error("SUPERVISOR: 状态为空");
      return {};
    }

    if (supervisorState.currentRound >= supervisorState.maxRounds) {
      logger.warn(`SUPERVISOR: 已达最大轮次 ${supervisorState.maxRounds}，强制完成`);
      supervisorState.isComplete = true;
      return { supervisorState };
    }

    const agentsDesc = this.agentInfos.map(a => `- ${a.id}: ${a.desc}`).join('\n');
    const workerIdList = this.agentInfos.map(a => a.id).join('/');

    const prompt = `系统提示：你是一个 Supervisor（主管）助手，只返回有效的 JSON 格式，不要包含其他文本。

你是一个多 Agent 协作的 Supervisor。你的职责是分析任务进展，决定下一步由哪个 Worker Agent 来处理，或者宣布任务完成。

**总体目标**: ${supervisorState.goal}

**可用的 Worker Agents**:
${agentsDesc}

**当前状态**:
- 轮次: ${supervisorState.currentRound + 1}/${supervisorState.maxRounds}
- 对话历史见上方 messages

请分析对话历史并以 JSON 格式返回决策：

{
  "thought": "你对当前进展的分析和推理",
  "next": "${workerIdList}/FINISH",
  "task": "给下一个 Worker 的具体任务描述（FINISH 时留空）"
}

决策规则：
1. 目标已完成或无需进一步操作 → next = "FINISH"
2. 需要某个 Worker 处理 → next 为 Worker ID，必须提供 task
3. next 必须是上面列出的 Worker ID 之一，或者 "FINISH"
4. task 描述具体目标，而非操作步骤
5. 每次只分配一个 Worker
6. Worker 已完成任务时，不要重复分配相同操作`;

    try {
      if (!this.supervisorConfig?.model) throw new Error('Supervisor 节点未配置 model');
      supervisorState.currentRound += 1;
      const iter = `[${supervisorState.currentRound}/${supervisorState.maxRounds}]`;
      logger.info(`SUPERVISOR ${iter}: 决策开始`);

      const modelService = (await config.getModelService(this.supervisorConfig.model, true))!;
      const response = await modelService.invoke([new SystemMessage(prompt), ...this.systemMessages, ...state.messages]);
      const decision = this.parseJsonResponse(response.content as string);

      if (decision.next === 'FINISH') {
        supervisorState.isComplete = true;
        supervisorState.currentWorker = null;
        supervisorState.currentTask = null;
        logger.info(`SUPERVISOR ${iter}: 任务完成`);
      } else {
        supervisorState.currentWorker = decision.next;
        supervisorState.currentTask = decision.task;
        logger.info(`SUPERVISOR ${iter}: → ${decision.next} | ${(decision.task ?? '').substring(0, 80)}`);
      }

      return {
        supervisorState,
        messages: [new AIMessage(`🎯 **Supervisor**: ${decision.thought}`)],
      };

    } catch (error: any) {
      logger.error(`SUPERVISOR: 决策失败 - ${error.message}`);
      supervisorState.isComplete = true;
      return { supervisorState, messages: [new AIMessage(`Supervisor 决策出错：${error.message}`)] };
    }
  }

  private routeAfterSupervisor(state: GraphState): string {
    const supervisorState = state.supervisorState;
    if (!supervisorState) {
      logger.error("ROUTE: Supervisor 状态为空");
      return END;
    }
    if (supervisorState.isComplete) return SupervisorNode.Finalize;

    const workerId = supervisorState.currentWorker;
    if (!workerId) {
      logger.warn("ROUTE: 无当前 Worker，回退到 Supervisor");
      return SupervisorNode.Supervisor;
    }
    const available = this.agentInfos.map(a => a.id);
    if (!available.includes(workerId)) {
      logger.warn(`ROUTE: 未知 Worker "${workerId}"，回退到 Supervisor`);
      return SupervisorNode.Supervisor;
    }
    return workerNodeName(workerId);
  }

  private async finalizeNode(state: GraphState) {
    const supervisorState = state.supervisorState;
    if (!supervisorState) {
      logger.error("FINALIZE: 状态为空");
      return {};
    }

    const prompt = `你是一个结果汇总助手。

请基于以下对话历史，生成最终总结：

**目标**: ${supervisorState.goal}

请生成一个简洁的总结，包括：
1. 完成了哪些主要任务
2. 获得了什么结果
3. 是否完全达成目标`;

    try {
      if (!this.supervisorConfig?.model) throw new Error('Supervisor 未配置 model');
      const modelService = (await config.getModelService(this.supervisorConfig.model, true))!;
      const response = await modelService.invoke([new SystemMessage(prompt), ...this.systemMessages, ...state.messages]);
      const summary = response.content as string;
      return { messages: [new AIMessage(`✨ **总结**:\n\n${summary}`)] };
    } catch (error: any) {
      logger.error(`FINALIZE: 总结失败 - ${error.message}`);
      return { messages: [new AIMessage(`任务执行完成，但生成总结时出错：${error.message}`)] };
    }
  }

  // ── Graph ────────────────────────────────────────────────────

  private async createWorkerNode(agentName: string) {
    return async (state: GraphState) => {
      const { onMessage: _, ...subCallback } = state.callback ?? {};
      const supervisorState = state.supervisorState;
      if (!supervisorState?.currentTask) {
        logger.warn(`Worker ${agentName}: 当前任务为空`);
        return {};
      }

      const task = supervisorState.currentTask;
      try {
        const subContainer = new ServiceContainer();
        if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
        const { AgentFactory } = await import('../../AgentFactory.js');
        const agentService = await AgentFactory.create(agentName, subContainer, this.userInfo);

        const taskPrompt = `你需要使用可用的工具来完成以下任务，直接执行操作并返回结果，不要只给出建议或步骤说明。\n\n任务: ${task}`;

        let workerResult = "";
        const messages: BaseMessage[] = [];

        await agentService.stream(taskPrompt, {
          onMessage: async (message: AgentMessage) => {
            if (message.type === MessageChunkType.AI && message.content) {
              workerResult += message.content;
              messages.push(new AIMessage(message.content));
            }
          },
          ...subCallback,
        });

        logger.info(`Worker ${agentName}: 任务完成`);
        // Worker 结果以 HumanMessage 形式反馈，Supervisor 在下一轮读取
        const report = new HumanMessage(`[Worker: ${agentName}] ${workerResult || "任务完成"}`);
        return { messages: [...messages, report] };

      } catch (error: any) {
        logger.error(`Worker ${agentName}: 执行失败 - ${error.message}`);
        const report = new HumanMessage(`[Worker: ${agentName}] 执行失败: ${error.message}`);
        return { messages: [new AIMessage(`⚠️ 执行失败: ${error.message}`), report] };
      }
    };
  }

  private async createGraph() {
    const workflow = new StateGraph(SupervisorAnnotation);

    workflow.addNode(SupervisorNode.Supervisor, (state) => this.supervisorNode(state));
    workflow.addNode(SupervisorNode.Finalize, (state) => this.finalizeNode(state));

    for (const ref of this.agentRefs) {
      workflow.addNode(workerNodeName(ref.name), await this.createWorkerNode(ref.name));
    }

    (workflow as any).addEdge(START, SupervisorNode.Supervisor);

    const routingMap: Record<string, string> = {
      [SupervisorNode.Supervisor]: SupervisorNode.Supervisor,
      [SupervisorNode.Finalize]: SupervisorNode.Finalize,
      END: END as any,
      ...Object.fromEntries(this.agentRefs.map(r => [workerNodeName(r.name), workerNodeName(r.name)])),
    };
    (workflow as any).addConditionalEdges(SupervisorNode.Supervisor, (s: GraphState) => this.routeAfterSupervisor(s), routingMap);

    for (const ref of this.agentRefs) {
      (workflow as any).addEdge(workerNodeName(ref.name), SupervisorNode.Supervisor);
    }
    (workflow as any).addEdge(SupervisorNode.Finalize, END);

    return workflow.compile({});
  }

  // ── Public API ───────────────────────────────────────────────

  async stream(query: string, callback: IAgentCallback): Promise<void> {
    try {
      const graph = await this.createGraph();

      logger.info(`Supervisor 开始 | 用户: ${this.agentSaver?.threadId} | Workers: [${this.agentRefs.map(r => r.name).join(', ')}] | 最大轮次: ${this.maxRounds} | 查询: ${query.substring(0, 80)}`);

      const graphStream = await graph.stream(
        {
          messages: [new HumanMessage(query)],
          supervisorState: {
            goal: query,
            currentWorker: null,
            currentTask: null,
            isComplete: false,
            maxRounds: this.maxRounds,
            currentRound: 0,
          } as SupervisorState,
          callback,
        },
        {
          streamMode: "updates",
          recursionLimit: this.maxRounds * 3 + 10,
        }
      );

      const { onMessage } = callback;
      let finalResult = "";

      for await (const update of graphStream) {
        // 收集 Finalize 节点的最终输出，用于写入记忆
        const finalizeOutput = (update as any)[SupervisorNode.Finalize];
        if (finalizeOutput) {
          for (const m of finalizeOutput.messages ?? []) {
            if ((m instanceof AIMessage || m instanceof AIMessageChunk) && m.content) {
              finalResult += m.content as string;
            }
          }
        }

        for (const nodeOutput of Object.values(update)) {
          for (const message of (nodeOutput as any).messages ?? []) {
            if (message instanceof HumanMessage) continue;
            const chunk = this.convertToMessageChunk(message);
            if (chunk) await onMessage?.(chunk);
          }
        }
      }

      // 只将最终总结写入记忆
      if (this.memoryService && finalResult) {
        try {
          await this.memoryService.memorizeConversation(query, finalResult);
        } catch (error: any) {
          logger.warn(`保存记忆失败: ${error.message}`);
        }
      }

      // 将 query 和最终总结保存到 saver
      if (this.agentSaver && finalResult) {
        try {
          await this.agentSaver.pushMessage(new HumanMessage(query));
          await this.agentSaver.pushMessage(new AIMessage(finalResult));
        } catch (error: any) {
          logger.warn(`保存对话到 saver 失败: ${error.message}`);
        }
      }

      logger.info("Supervisor 完成");
    } catch (error: any) {
      logger.error(`Supervisor 失败 - ${error.message}`);
      throw error;
    }
  }

  override async dispose() {
    return super.dispose();
  }
}
