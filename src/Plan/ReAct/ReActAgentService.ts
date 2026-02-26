import { HumanMessage, AIMessage, AIMessageChunk, BaseMessage, SystemMessage } from "langchain";
import { Annotation, MessagesAnnotation, StateGraph, START, END } from '@langchain/langgraph';
import { AgentNodeConfig, AgentRef, config } from '../../Config.js';
import {
  AgentServiceBase,
  IAgentCallback, MessageChunkType, AgentMessage,
  IMemoryService, IAgentSaverService,
  inject, ServiceContainer, ModelServiceFactory, T_SystemPrompts,
} from 'scorpio.ai';
import { LoggerService } from '../../LoggerService.js';
import { v4 as uuidv4 } from 'uuid';

const logger = LoggerService.getLogger("ReActAgentService");

// ── Types & Annotation ────────────────────────────────────────

export enum ReActNode {
  Think = "think",
  Action = "action",
  Observe = "observe",
  Reflect = "reflect",
  WaitForUser = "wait_for_user",
}

export enum ReActDecision {
  Action = "action",
  WaitForUser = "wait_for_user",
  Complete = "complete",
}

export function agentNodeName(agentId: string): string {
  return `agent_${agentId}`;
}

export interface ReActStep {
  id: string;
  type: ReActNode;
  content: string;
  agentType?: string;
  result?: string;
  timestamp: number;
}

export interface ReActState {
  goal: string;
  currentStep: ReActStep | null;
  steps: ReActStep[];
  isComplete: boolean;
  maxIterations: number;
  currentIteration: number;
}

export const ReActAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  reactState: Annotation<ReActState | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  agentInfos: Annotation<{ id: string; desc: string }[]>({
    reducer: (prev, next) => next ?? prev,
    default: () => [],
  }),
  callback: Annotation<IAgentCallback | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
});

type GraphState = typeof ReActAnnotation.State;


// ── ReadOnlyMemoryService ─────────────────────────────────────

/**
 * 只读记忆包装器：sub-agent 可读取上下文记忆，但不写入。
 * 写入由 ReActAgentService 在 Reflect 完成后统一处理。
 */
class ReadOnlyMemoryService implements IMemoryService {
  constructor(private readonly inner: IMemoryService) {}
  getSystemMessage(query: string, limit?: number) { return this.inner.getSystemMessage(query, limit); }
  getTools() { return this.inner.getTools(); }
  async memorizeConversation() {}   // no-op
  async compressMemories() { return 0; }
  async clearAll() { return 0; }
  async dispose() {}
}

// ── ReActAgentService ─────────────────────────────────────────

/**
 * ReAct Agent 服务，实现 Reasoning and Acting 模式的多 Agent 协同。
 *
 * 循环：Think → Agent → Observe → Think → ... → Reflect
 *
 * WaitForUser：Think 决定需要用户输入时，调用 callback.askUser() 等待回答，
 * graph stream 在此暂停（同 executeTool 模式），不中断整个对话。
 */
export class ReActAgentService extends AgentServiceBase {
  private agentRefs: AgentRef[];
  private maxIterations: number;
  private thinkConfig?: AgentNodeConfig;
  private reflectConfig?: AgentNodeConfig;
  private userInfo?: any;

  constructor(
    @inject("agentRefs") agentRefs: AgentRef[],
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject("maxIterations", { optional: true }) maxIterations?: number,
    @inject("thinkConfig", { optional: true }) thinkConfig?: AgentNodeConfig,
    @inject("reflectConfig", { optional: true }) reflectConfig?: AgentNodeConfig,
    @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
    @inject("userInfo", { optional: true }) userInfo?: any,
  ) {
    super(null as any, systemPrompts, undefined, agentSaver, undefined, memoryService);
    this.agentRefs = agentRefs;
    this.maxIterations = maxIterations ?? 5;
    this.thinkConfig = thinkConfig;
    this.reflectConfig = reflectConfig;
    this.userInfo = userInfo;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private makeStep(type: ReActNode, content: string, agentType?: string): ReActStep {
    return { id: uuidv4(), type, content, agentType, timestamp: Date.now() };
  }

  private formatStepHistory(steps: ReActStep[]): string {
    if (steps.length === 0) return "暂无历史步骤";
    return steps.map((step, i) => {
      const prefix = `步骤 ${i + 1} [${step.type}]`;
      switch (step.type) {
        case ReActNode.Think:       return `${prefix} 思考: ${step.content}`;
        case ReActNode.Action:      return `${prefix} 行动: ${step.content} (使用 ${step.agentType} Agent)`;
        case ReActNode.Observe:     return `${prefix} 观察: ${step.content}`;
        case ReActNode.Reflect:     return `${prefix} 反思: ${step.content}`;
        case ReActNode.WaitForUser: return `${prefix} 等待用户: ${step.content}`;
        default:                    return `${prefix}: ${step.content}`;
      }
    }).join('\n');
  }

  private parseJsonResponse(content: string): any {
    const stripped = content.trim().replace(/^```json\s*|^```\s*|```\s*$/gm, '');
    return JSON.parse(stripped.trim());
  }

  private resolveAgentId(agentId: string | undefined, available: string[]): string | undefined {
    if (agentId && available.includes(agentId)) return agentId;
    logger.warn(`THINK: agentId "${agentId}" 无效，可用: [${available.join(', ')}]`);
    const fuzzy = available.find(id => id.startsWith(agentId ?? '') || (agentId ?? '').startsWith(id));
    if (fuzzy) return fuzzy;
    if (available.length > 0) return available[0];
    logger.error("THINK: 没有可用的 Agent");
    return undefined;
  }

  // ── Node Functions ───────────────────────────────────────────

  /**
   * THINK 节点：推理下一步行动。
   * 当决策为 wait_for_user 时，直接 await callback.askUser()，
   * graph stream 在此暂停等待用户回答，无需中断重启。
   */
  private async thinkNode(state: GraphState) {
    const callback = state.callback ?? undefined;
    const reactState = state.reactState;
    if (!reactState) {
      logger.error("THINK: ReAct 状态为空");
      return {};
    }

    if (reactState.currentIteration >= reactState.maxIterations) {
      logger.warn(`THINK: 已达最大迭代次数 ${reactState.maxIterations}，强制完成`);
      reactState.isComplete = true;
      return { reactState };
    }

    const lastHuman = [...state.messages].reverse().find(m => m instanceof HumanMessage);
    const userQuery = lastHuman ? (lastHuman.content as string) : reactState.goal;
    const agentsDesc = state.agentInfos.map(a => `- ${a.id}: ${a.desc}`).join('\n');
    const agentIdList = state.agentInfos.map(a => a.id).join('/');

    const prompt = `系统提示：你是一个 ReAct 规划助手，只返回有效的 JSON 格式，不要包含其他文本。

你是一个 ReAct (Reasoning and Acting) 规划专家。请分析当前情况并决定下一步行动。

**总体目标**: ${reactState.goal}
**用户原始请求**: ${userQuery}

**可用的 Agent**:
${agentsDesc}

**已执行的步骤历史**:
${this.formatStepHistory(reactState.steps)}

**当前状态**:
- 迭代次数: ${reactState.currentIteration + 1}/${reactState.maxIterations}
- 目标是否完成: ${reactState.isComplete ? '是' : '否'}

请进行推理并以 JSON 格式返回你的决策：

{
  "thought": "你的推理过程和分析",
  "decision": "${ReActDecision.Action}/${ReActDecision.WaitForUser}/${ReActDecision.Complete}",
  "nextAction": {
    "description": "需要 Agent 使用工具完成的具体任务描述",
    "agentId": "${agentIdList}",
    "reason": "为什么选择这个 Agent"
  },
  "waitMessage": "需要用户确认或提供信息的问题"
}

decision 说明：
- "${ReActDecision.Action}": 需要 Agent 执行操作，必须提供 nextAction
- "${ReActDecision.WaitForUser}": 需要用户确认或补充信息才能继续，必须提供 waitMessage
- "${ReActDecision.Complete}": 目标已完成

规则：
1. 目标已完成 → decision = "${ReActDecision.Complete}"
2. 需要执行操作 → decision = "${ReActDecision.Action}"，提供 nextAction
3. 需要用户确认 → decision = "${ReActDecision.WaitForUser}"，提供 waitMessage
4. agentId 必须是上面列出的可用 Agent ID 之一
5. nextAction.description 描述最终目标，而非操作步骤
6. 每次只规划一个行动
7. 基于历史结果决策，行动已完成则 decision = "${ReActDecision.Complete}"
8. 观察结果表明任务完成时，不要重复执行相同行动`;

    try {
      if (!this.thinkConfig?.model) throw new Error('ReAct think 节点未配置 model');
      logger.info(`THINK: 推理开始`);
      const thinkModelService = await ModelServiceFactory.getModelService(config.getModel(this.thinkConfig.model)!);
      const response = await thinkModelService.invoke(prompt);
      const decision = this.parseJsonResponse(response.content as string);

      reactState.steps.push(this.makeStep(ReActNode.Think, decision.thought));
      reactState.currentIteration += 1;

      const decisionType: ReActDecision = decision.decision
        ?? (decision.isComplete ? ReActDecision.Complete : decision.needsAction ? ReActDecision.Action : ReActDecision.Complete);

      const iter = `[${reactState.currentIteration}/${reactState.maxIterations}]`;

      if (decisionType === ReActDecision.Complete) {
        reactState.isComplete = true;
        reactState.currentStep = null;
        logger.info(`THINK ${iter}: 任务完成`);

      } else if (decisionType === ReActDecision.WaitForUser) {
        const waitMsg = decision.waitMessage || decision.thought;
        reactState.steps.push(this.makeStep(ReActNode.WaitForUser, waitMsg));
        logger.info(`THINK ${iter}: 等待用户`);

        if (callback?.askUser) {
          // 同 executeTool：在节点内 await，stream 暂停，不中断对话
          const answer = await callback.askUser(waitMsg);
          reactState.steps.push(this.makeStep(ReActNode.Observe, `用户回复: ${answer}`));
          logger.info(`THINK ${iter}: 收到用户回复`);
        } else {
          // 无 askUser 回调时降级为完成，避免无限循环
          logger.warn(`THINK ${iter}: 无 askUser 回调，强制完成`);
          reactState.isComplete = true;
        }
        reactState.currentStep = null;

      } else if (decisionType === ReActDecision.Action && decision.nextAction) {
        const available = state.agentInfos.map(a => a.id);
        const agentId = this.resolveAgentId(decision.nextAction.agentId ?? decision.nextAction.agentType, available);
        const actionStep = this.makeStep(ReActNode.Action, decision.nextAction.description, agentId);
        reactState.steps.push(actionStep);
        reactState.currentStep = actionStep;
        logger.info(`THINK ${iter}: → ${agentId} | ${decision.nextAction.description.substring(0, 80)}`);

      } else {
        reactState.currentStep = null;
        logger.info(`THINK ${iter}: 无需行动`);
      }

      return { reactState, messages: [new AIMessage(`🤔 **思考**: ${decision.thought}`)] };

    } catch (error: any) {
      logger.error(`THINK: 推理失败 - ${error.message}`);
      reactState.isComplete = true;
      return { reactState, messages: [new AIMessage(`推理过程出错：${error.message}`)] };
    }
  }

  private routeAfterThink(state: GraphState): string {
    const reactState = state.reactState;
    if (!reactState) {
      logger.error("ROUTE: ReAct 状态为空");
      return END;
    }
    if (reactState.isComplete) return ReActNode.Reflect;

    if (reactState.currentStep?.type === ReActNode.Action) {
      const agentId = reactState.currentStep.agentType;
      if (!agentId) {
        logger.warn("ROUTE: Action 步骤缺少 agentId，回退到 Think");
        return ReActNode.Think;
      }
      const available = state.agentInfos.map(a => a.id);
      if (!available.includes(agentId)) {
        logger.warn(`ROUTE: 未知 agentId "${agentId}"，回退到 Think`);
        return ReActNode.Think;
      }
      return agentNodeName(agentId);
    }

    return ReActNode.Think;
  }

  private async observeNode(state: GraphState, actionResult: string) {
    const reactState = state.reactState;
    if (!reactState) {
      logger.error("OBSERVE: ReAct 状态为空");
      return {};
    }

    if (reactState.currentStep) {
      reactState.currentStep.result = actionResult;
    }

    const maxLen = 1000;
    const content = actionResult.length > maxLen
      ? actionResult.substring(0, maxLen) + '...(结果已截断)'
      : actionResult;

    reactState.steps.push(this.makeStep(ReActNode.Observe, content));
    reactState.currentStep = null;

    const preview = content.substring(0, 500) + (content.length > 500 ? '...' : '');
    return { reactState, messages: [new AIMessage(`👀 **观察**: ${preview}`)] };
  }

  private async reflectNode(state: GraphState) {
    const reactState = state.reactState;
    if (!reactState) {
      logger.error("REFLECT: ReAct 状态为空");
      return {};
    }

    const prompt = `你是一个结果总结助手。

请基于以下执行过程，生成最终总结：

**目标**: ${reactState.goal}

**执行过程**:
${this.formatStepHistory(reactState.steps)}

请生成一个简洁的总结，包括：
1. 完成了哪些主要任务
2. 获得了什么结果
3. 是否完全达成目标`;

    try {
      if (!this.reflectConfig?.model) throw new Error('ReAct reflect 节点未配置 model');
      const modelService = await ModelServiceFactory.getModelService(config.getModel(this.reflectConfig.model)!);
      const response = await modelService.invoke(prompt);
      const reflection = response.content as string;
      reactState.steps.push(this.makeStep(ReActNode.Reflect, reflection));
      return { reactState, messages: [new AIMessage(`✨ **总结**:\n\n${reflection}`)] };
    } catch (error: any) {
      logger.error(`REFLECT: 反思失败 - ${error.message}`);
      return { messages: [new AIMessage(`任务执行完成，但生成总结时出错：${error.message}`)] };
    }
  }

  // ── Graph ────────────────────────────────────────────────────

  private async createSubAgentNode(agentName: string) {
    return async (state: GraphState) => {
      const { onMessage: _, ...subCallback } = state.callback ?? {};
      const reactState = state.reactState;
      if (!reactState?.currentStep) {
        logger.warn(`Sub-Agent ${agentName}: 当前步骤为空`);
        return {};
      }

      const currentStep = reactState.currentStep;
      try {
        const subContainer = new ServiceContainer();
        if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
        const { AgentFactory } = await import('../../AgentFactory.js');
        const agentService = await AgentFactory.create(agentName, subContainer, this.userInfo);

        const taskPrompt = `你需要使用可用的工具来完成以下任务，直接执行操作并返回结果，不要只给出建议或步骤说明。\n\n任务: ${currentStep.content}`;

        let actionResult = "";
        const messages: BaseMessage[] = [];

        await agentService.stream(taskPrompt, {
          onMessage: async (message: AgentMessage) => {
            if (message.type === MessageChunkType.AI && message.content) {
              actionResult += message.content;
              messages.push(new AIMessage(message.content));
            }
          },
          ...subCallback,
        });

        logger.info(`Sub-Agent ${agentName}: 步骤完成`);
        const observeResult = await this.observeNode(state, actionResult || "任务完成");
        return { ...observeResult, messages };

      } catch (error: any) {
        logger.error(`Sub-Agent ${agentName}: 执行失败 - ${error.message}`);
        const observeResult = await this.observeNode(state, `执行失败: ${error.message}`);
        return { ...observeResult, messages: [new AIMessage(`⚠️ 执行失败: ${error.message}`)] };
      }
    };
  }

  private async createGraph() {
    const workflow = new StateGraph(ReActAnnotation);

    workflow.addNode(ReActNode.Think, (state) => this.thinkNode(state));
    workflow.addNode(ReActNode.Reflect, (state) => this.reflectNode(state));

    for (const ref of this.agentRefs) {
      workflow.addNode(agentNodeName(ref.name), await this.createSubAgentNode(ref.name));
    }

    (workflow as any).addEdge(START, ReActNode.Think);

    const routingMap: Record<string, string> = {
      [ReActNode.Think]: ReActNode.Think,
      [ReActNode.Reflect]: ReActNode.Reflect,
      END: END as any,
      ...Object.fromEntries(this.agentRefs.map(r => [agentNodeName(r.name), agentNodeName(r.name)])),
    };
    (workflow as any).addConditionalEdges(ReActNode.Think, (s: GraphState) => this.routeAfterThink(s), routingMap);

    for (const ref of this.agentRefs) {
      (workflow as any).addEdge(agentNodeName(ref.name), ReActNode.Think);
    }
    (workflow as any).addEdge(ReActNode.Reflect, END);

    return workflow.compile({});
  }

  // ── Public API ───────────────────────────────────────────────

  async stream(query: string, callback: IAgentCallback): Promise<void> {
    try {
      const graph = await this.createGraph();

      const agentInfos = this.agentRefs.map(ref => ({ id: ref.name, desc: ref.desc }));

      logger.info(`ReAct 开始 | 用户: ${this.agentSaver?.threadId} | Agents: [${this.agentRefs.map(r => r.name).join(', ')}] | 最大迭代: ${this.maxIterations} | 查询: ${query.substring(0, 80)}`);

      const graphStream = await graph.stream(
        {
          messages: [
            ...(this.systemPrompts ?? []).map(p => new SystemMessage(p)),
            new HumanMessage(query),
          ],
          reactState: {
            goal: query,
            currentStep: null,
            steps: [],
            isComplete: false,
            maxIterations: this.maxIterations,
            currentIteration: 0,
          } as ReActState,
          agentInfos,
          callback,
        },
        {
          streamMode: "updates",
          recursionLimit: this.maxIterations * 4 + 10,

        }
      );

      const { onMessage } = callback;
      let reflectResult = "";

      for await (const update of graphStream) {
        // 收集 Reflect 节点的最终输出，用于写入记忆
        const reflectOutput = (update as any)[ReActNode.Reflect];
        if (reflectOutput) {
          for (const m of reflectOutput.messages ?? []) {
            if ((m instanceof AIMessage || m instanceof AIMessageChunk) && m.content) {
              reflectResult += m.content as string;
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

      // 只将最终 Reflect 结果写入记忆，中间状态不写入
      if (this.memoryService && reflectResult) {
        try {
          await this.memoryService.memorizeConversation(query, reflectResult);
        } catch (error: any) {
          logger.warn(`保存记忆失败: ${error.message}`);
        }
      }

      // 将 query 和最终总结保存到 saver（对话历史）
      if (this.agentSaver && reflectResult) {
        try {
          await this.agentSaver.pushMessage(new HumanMessage(query));
          await this.agentSaver.pushMessage(new AIMessage(reflectResult));
        } catch (error: any) {
          logger.warn(`保存对话到 saver 失败: ${error.message}`);
        }
      }

      logger.info("ReAct 完成");
    } catch (error: any) {
      logger.error(`ReAct 失败 - ${error.message}`);
      throw error;
    }
  }

  override async dispose() {
    return super.dispose();
  }
}
