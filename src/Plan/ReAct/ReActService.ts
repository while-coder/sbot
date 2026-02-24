import { HumanMessage, AIMessage, AIMessageChunk, BaseMessage } from "langchain";
import { Annotation, MessagesAnnotation, StateGraph, START, END } from '@langchain/langgraph';
import { AgentConfig } from '../Supervisor/SupervisorAnnotation.js';
import { AgentService, IAgentCallback, MessageChunkType, AgentMessage } from 'scorpio.ai';
import { FilteredAgentToolService } from '../FilteredAgentToolService.js';
import { IAgentSaverService, IModelService, ISkillService, IMemoryService, IAgentToolService, inject, ServiceContainer, T_ThreadId } from 'scorpio.ai';
import { SharedAgentSaver } from '../SharedAgentSaver.js';
import { LoggerService } from '../../LoggerService.js';
import { v4 as uuidv4 } from 'uuid';

const logger = LoggerService.getLogger("ReActService.ts");

// ============================================================
// Types & Annotation
// ============================================================

/**
 * ReAct 节点/步骤类型
 */
export enum ReActNode {
  Think = "think",
  Action = "action",
  Observe = "observe",
  Reflect = "reflect",
  WaitForUser = "wait_for_user",
}

/**
 * 根据 Agent ID 生成节点名称
 */
export function agentNodeName(agentId: string): string {
  return `agent_${agentId}`;
}

/**
 * ReAct 步骤
 */
export interface ReActStep {
  id: string;
  type: ReActNode;
  content: string;
  agentType?: string;
  result?: string;
  timestamp: number;
}

/**
 * ReAct 状态
 */
export interface ReActState {
  goal: string;
  currentStep: ReActStep | null;
  steps: ReActStep[];
  isComplete: boolean;
  waitingForUser: boolean;
  maxIterations: number;
  currentIteration: number;
}

/**
 * ReAct 状态 Annotation
 */
export const ReActAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,

  reactState: Annotation<ReActState | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),

  agentConfigs: Annotation<any[]>({
    reducer: (prev, next) => next ?? prev,
    default: () => [],
  }),
});

// ============================================================
// Node Functions
// ============================================================

/**
 * 格式化 ReAct 步骤历史
 */
function formatStepHistory(steps: ReActStep[]): string {
  if (steps.length === 0) return "暂无历史步骤";

  return steps.map((step, index) => {
    const prefix = `步骤 ${index + 1} [${step.type}]`;
    switch (step.type) {
      case ReActNode.Think:
        return `${prefix} 思考: ${step.content}`;
      case ReActNode.Action:
        return `${prefix} 行动: ${step.content} (使用 ${step.agentType} Agent)`;
      case ReActNode.Observe:
        return `${prefix} 观察: ${step.content}`;
      case ReActNode.Reflect:
        return `${prefix} 反思: ${step.content}`;
      case ReActNode.WaitForUser:
        return `${prefix} 等待用户: ${step.content}`;
      default:
        return `${prefix}: ${step.content}`;
    }
  }).join('\n');
}

/**
 * THINK 节点：推理下一步行动
 */
async function thinkNode(
  state: typeof ReActAnnotation.State,
  modelService: IModelService
) {
  const reactState = state.reactState;
  if (!reactState) {
    logger.error("THINK: ReAct 状态为空");
    return {};
  }

  // 如果是从等待用户确认恢复的，记录用户回复
  if (reactState.waitingForUser) {
    const lastHumanMsg = state.messages
      .slice()
      .reverse()
      .find(m => m._getType() === 'human');

    if (lastHumanMsg) {
      const userReply: ReActStep = {
        id: uuidv4(),
        type: ReActNode.Observe,
        content: `用户回复: ${lastHumanMsg.content as string}`,
        timestamp: Date.now()
      };
      reactState.steps.push(userReply);
    }
    reactState.waitingForUser = false;
  }

  // 检查是否达到最大迭代次数
  if (reactState.currentIteration >= reactState.maxIterations) {
    logger.warn(`THINK: 已达最大迭代次数 ${reactState.maxIterations}，强制完成`);
    reactState.isComplete = true;
    return { reactState };
  }

  // 查找最后一条人类消息
  const lastHumanMessage = state.messages
    .slice()
    .reverse()
    .find(m => m._getType() === 'human');

  const userQuery = lastHumanMessage ? (lastHumanMessage.content as string) : reactState.goal;

  // 构建可用 Agent 描述
  const agentsDesc = state.agentConfigs
    .map((a: any) => `- ${a.id}: ${a.desc || a.systemPrompt || '通用任务'}`)
    .join('\n');

  // 可用 Agent ID 列表（用于 JSON 示例）
  const agentIdList = state.agentConfigs.map((a: any) => a.id).join('/');

  // 构建步骤历史
  const stepHistory = formatStepHistory(reactState.steps);

  // 构建思考提示词
  const thinkPrompt = `你是一个 ReAct (Reasoning and Acting) 规划专家。请分析当前情况并决定下一步行动。

**总体目标**: ${reactState.goal}

**用户原始请求**: ${userQuery}

**可用的 Agent**:
${agentsDesc}

**已执行的步骤历史**:
${stepHistory}

**当前状态**:
- 迭代次数: ${reactState.currentIteration + 1}/${reactState.maxIterations}
- 目标是否完成: ${reactState.isComplete ? '是' : '否'}

请进行推理并以 JSON 格式返回你的决策：

{
  "thought": "你的推理过程和分析",
  "decision": "action/wait_for_user/complete",
  "nextAction": {
    "description": "需要 Agent 使用工具完成的具体任务描述",
    "agentId": "${agentIdList}",
    "reason": "为什么选择这个 Agent"
  },
  "waitMessage": "需要用户确认或提供信息的问题"
}

decision 说明：
- "action": 需要 Agent 执行操作，必须提供 nextAction
- "wait_for_user": 需要用户确认或补充信息才能继续，必须提供 waitMessage
- "complete": 目标已完成

规则：
1. 如果目标已经完成，设置 decision = "complete"
2. 如果需要执行操作，设置 decision = "action"，并提供 nextAction
3. 如果需要用户确认操作结果或补充信息，设置 decision = "wait_for_user"，并提供 waitMessage
4. agentId 必须是上面列出的可用 Agent ID 之一，不要使用未列出的 ID
5. 每个 Agent 都有自己的工具可以自主执行任务，nextAction.description 应描述最终要达成的目标，而非操作步骤
6. 每次只规划一个行动，不要一次性规划多个步骤
7. 基于历史步骤的结果进行决策，如果之前的行动已完成目标则设置 decision = "complete"
8. 如果一个行动的观察结果表明任务已经完成，不要重复执行相同行动`;

  try {
    const fullPrompt = `系统提示：你是一个 ReAct 规划助手，只返回有效的 JSON 格式，不要包含其他文本。

${thinkPrompt}`;

    const response = await modelService.invoke(fullPrompt);
    const content = response.content as string;

    // 提取 JSON
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\s*/, '').replace(/```\s*$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\s*/, '').replace(/```\s*$/, '');
    }

    const decision = JSON.parse(jsonStr);

    // 创建思考步骤
    const thinkStep: ReActStep = {
      id: uuidv4(),
      type: ReActNode.Think,
      content: decision.thought,
      timestamp: Date.now()
    };

    reactState.steps.push(thinkStep);
    reactState.currentIteration += 1;

    // 根据决策类型处理
    const decisionType = decision.decision || (decision.isComplete ? 'complete' : decision.needsAction ? 'action' : 'complete');

    if (decisionType === 'complete') {
      // 任务完成
      reactState.isComplete = true;
      reactState.currentStep = null;
      logger.info(`THINK [${reactState.currentIteration}/${reactState.maxIterations}]: 任务完成`);

    } else if (decisionType === 'wait_for_user') {
      // 等待用户确认
      reactState.waitingForUser = true;
      reactState.currentStep = null;

      const waitStep: ReActStep = {
        id: uuidv4(),
        type: ReActNode.WaitForUser,
        content: decision.waitMessage || decision.thought,
        timestamp: Date.now()
      };
      reactState.steps.push(waitStep);

      logger.info(`THINK [${reactState.currentIteration}/${reactState.maxIterations}]: 等待用户确认`);

      return {
        reactState,
        messages: [new AIMessage(decision.waitMessage || decision.thought)]
      };

    } else if (decisionType === 'action' && decision.nextAction) {
      // 执行行动
      const availableAgentIds = state.agentConfigs.map((a: any) => a.id as string);
      let agentId: string | undefined = decision.nextAction.agentId || decision.nextAction.agentType;

      if (!agentId || !availableAgentIds.includes(agentId)) {
        logger.warn(`THINK: agentId "${agentId}" 无效，可用: [${availableAgentIds.join(', ')}]`);
        const fuzzyMatch = availableAgentIds.find((id: string) =>
          id.startsWith(agentId!) || agentId!.startsWith(id)
        );
        if (fuzzyMatch) {
          agentId = fuzzyMatch;
        } else if (availableAgentIds.length > 0) {
          agentId = availableAgentIds[0];
        } else {
          logger.error("THINK: 没有可用的 Agent");
          agentId = undefined;
        }
      }

      const actionStep: ReActStep = {
        id: uuidv4(),
        type: ReActNode.Action,
        content: decision.nextAction.description,
        agentType: agentId,
        timestamp: Date.now()
      };

      reactState.steps.push(actionStep);
      reactState.currentStep = actionStep;

      logger.info(`THINK [${reactState.currentIteration}/${reactState.maxIterations}]: → ${agentId} | ${decision.nextAction.description.substring(0, 80)}`);

    } else {
      reactState.currentStep = null;
      logger.info(`THINK [${reactState.currentIteration}/${reactState.maxIterations}]: 无需行动`);
    }

    return {
      reactState,
      messages: [new AIMessage(`🤔 **思考**: ${decision.thought}`)]
    };
  } catch (error: any) {
    logger.error(`THINK: 推理失败 - ${error.message}`);
    reactState.isComplete = true;
    return {
      reactState,
      messages: [new AIMessage(`推理过程出错：${error.message}`)]
    };
  }
}

/**
 * Think 节点的条件路由函数
 */
function routeAfterThink(state: typeof ReActAnnotation.State): string {
  const reactState = state.reactState;

  if (!reactState) {
    logger.error("ROUTE: ReAct 状态为空");
    return END;
  }

  // 等待用户确认 → 结束当前执行
  if (reactState.waitingForUser) {
    return END;
  }

  // 任务完成 → 反思总结
  if (reactState.isComplete) {
    return ReActNode.Reflect;
  }

  // 有 Action 步骤 → 路由到对应 Agent
  if (reactState.currentStep && reactState.currentStep.type === ReActNode.Action) {
    const agentId = reactState.currentStep.agentType;
    if (!agentId) {
      logger.warn("ROUTE: Action 步骤缺少 agentId，回退到 Think");
      return ReActNode.Think;
    }
    const availableAgentIds = state.agentConfigs.map((a: any) => a.id);
    if (!availableAgentIds.includes(agentId)) {
      logger.warn(`ROUTE: 未知 agentId "${agentId}"，回退到 Think`);
      return ReActNode.Think;
    }
    return agentNodeName(agentId);
  }

  // 默认继续思考
  return ReActNode.Think;
}

/**
 * OBSERVE 节点：观察行动结果
 */
async function observeNode(
  state: typeof ReActAnnotation.State,
  actionResult: string
) {
  const reactState = state.reactState;
  if (!reactState) {
    logger.error("OBSERVE: ReAct 状态为空");
    return {};
  }

  // 更新当前步骤的结果
  if (reactState.currentStep) {
    reactState.currentStep.result = actionResult;
  }

  // 创建观察步骤（限制内容长度避免 prompt 膨胀）
  const maxObserveLength = 1000;
  const observeContent = actionResult.length > maxObserveLength
    ? actionResult.substring(0, maxObserveLength) + '...(结果已截断)'
    : actionResult;

  const observeStep: ReActStep = {
    id: uuidv4(),
    type: ReActNode.Observe,
    content: observeContent,
    timestamp: Date.now()
  };

  reactState.steps.push(observeStep);
  reactState.currentStep = null;

  return {
    reactState,
    messages: [new AIMessage(`👀 **观察**: ${observeContent.substring(0, 500)}${observeContent.length > 500 ? '...' : ''}`)]
  };
}

/**
 * REFLECT 节点：最终反思和总结
 */
async function reflectNode(
  state: typeof ReActAnnotation.State,
  modelService: IModelService
) {
  const reactState = state.reactState;
  if (!reactState) {
    logger.error("REFLECT: ReAct 状态为空");
    return {};
  }

  const stepHistory = formatStepHistory(reactState.steps);

  const reflectPrompt = `请基于以下执行过程，生成最终总结：

**目标**: ${reactState.goal}

**执行过程**:
${stepHistory}

请生成一个简洁的总结，包括：
1. 完成了哪些主要任务
2. 获得了什么结果
3. 是否完全达成目标`;

  try {
    const response = await modelService.invoke(`系统提示：你是一个结果总结助手。\n\n${reflectPrompt}`);
    const reflection = response.content as string;

    const reflectStep: ReActStep = {
      id: uuidv4(),
      type: ReActNode.Reflect,
      content: reflection,
      timestamp: Date.now()
    };

    reactState.steps.push(reflectStep);

    return {
      reactState,
      messages: [new AIMessage(`✨ **总结**:\n\n${reflection}`)]
    };
  } catch (error: any) {
    logger.error(`REFLECT: 反思失败 - ${error.message}`);
    return {
      messages: [new AIMessage(`任务执行完成，但生成总结时出错：${error.message}`)]
    };
  }
}

// ============================================================
// ReActService
// ============================================================

/**
 * ReAct Agent 服务
 * 实现 ReAct (Reasoning and Acting) 模式的多 Agent 协同
 *
 * ReAct 循环：Think → Agent → Observe → Think → ... → Reflect
 * 支持 WaitForUser：Think 可决定暂停等用户确认，下次消息自动恢复
 */
export class ReActService {
  private userId: string;
  private threadId: string;
  private agentConfigs: AgentConfig[];
  private modelService: IModelService;
  private agentSaver: IAgentSaverService;
  private toolService?: IAgentToolService;
  private skillService?: ISkillService;
  private memoryService?: IMemoryService;
  private maxIterations: number;

  constructor(
    @inject("userId") userId: string,
    @inject("threadId") threadId: string,
    @inject("agentConfigs") agentConfigs: AgentConfig[],
    @inject(IModelService) modelService: IModelService,
    @inject(IAgentSaverService) agentSaver: IAgentSaverService,
    @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    @inject(ISkillService, { optional: true }) skillService?: ISkillService,
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject("maxIterations", { optional: true }) maxIterations?: number
  ) {
    this.userId = userId;
    this.threadId = threadId;
    this.agentConfigs = agentConfigs;
    this.modelService = modelService;
    this.agentSaver = agentSaver;
    this.toolService = toolService;
    this.skillService = skillService;
    this.memoryService = memoryService;
    this.maxIterations = maxIterations ?? 5;
  }

  /**
   * 创建 Sub-Agent 节点函数
   */
  private async createSubAgentNode(
    agentConfig: AgentConfig,
    callback?: Omit<IAgentCallback, 'onMessage'>
  ) {
    return async (state: typeof ReActAnnotation.State) => {
      const reactState = state.reactState;
      if (!reactState || !reactState.currentStep) {
        logger.warn(`Sub-Agent ${agentConfig.id}: 当前步骤为空`);
        return {};
      }

      const currentStep = reactState.currentStep;

      try {
        // 为这个 Sub-Agent 创建独立的 ServiceContainer
        const subContainer = new ServiceContainer();

        subContainer.registerInstance(IModelService, this.modelService);
        subContainer.registerInstance(IAgentSaverService, new SharedAgentSaver(this.agentSaver));

        if (this.skillService) {
          subContainer.registerInstance(ISkillService, this.skillService);
        }
        if (this.memoryService) {
          subContainer.registerInstance(IMemoryService, this.memoryService);
        }
        if (this.toolService) {
          const filteredToolService = new FilteredAgentToolService(
            agentConfig.tools,
            this.toolService
          );
          subContainer.registerInstance(IAgentToolService, filteredToolService);
        }

        subContainer.registerWithArgs(AgentService, {
          [T_ThreadId]: `${this.threadId}_react_${agentConfig.id}_${currentStep.id}`
        });
        const agentService = await subContainer.resolve(AgentService);

        const taskPrompt = [
          agentConfig.systemPrompt || '',
          '',
          `你需要使用可用的工具来完成以下任务，直接执行操作并返回结果，不要只给出建议或步骤说明。`,
          '',
          `任务: ${currentStep.content}`,
        ].filter(Boolean).join('\n');

        let actionResult = "";
        const messages: BaseMessage[] = [];

        await agentService.stream(
          taskPrompt,
          {
            onMessage: async (message: AgentMessage) => {
              if (message.type === MessageChunkType.AI && message.content) {
                actionResult += message.content;
                messages.push(new AIMessage(message.content));
              }
            },
            ...callback,
          }
        );

        logger.info(`Sub-Agent ${agentConfig.id}: 步骤完成`);

        const observeResult = await observeNode(state, actionResult || "任务完成");

        return {
          ...observeResult,
          messages: messages
        };
      } catch (error: any) {
        logger.error(`Sub-Agent ${agentConfig.id}: 执行失败 - ${error.message}`);

        const observeResult = await observeNode(state, `执行失败: ${error.message}`);

        return {
          ...observeResult,
          messages: [new AIMessage(`⚠️ 执行失败: ${error.message}`)]
        };
      }
    };
  }

  /**
   * 创建 ReAct 图
   */
  private async createGraph(
    callback?: Omit<IAgentCallback, 'onMessage'>
  ) {
    const workflow = new StateGraph(ReActAnnotation);

    // 添加节点
    workflow.addNode(ReActNode.Think, (state) => thinkNode(state, this.modelService));
    workflow.addNode(ReActNode.Reflect, (state) => reflectNode(state, this.modelService));

    for (const agentConfig of this.agentConfigs) {
      const nodeName = agentNodeName(agentConfig.id);
      const nodeFunc = await this.createSubAgentNode(
        agentConfig, callback
      );
      workflow.addNode(nodeName, nodeFunc);
    }

    // 边：START → Think
    (workflow as any).addEdge(START, ReActNode.Think);

    // Think 的条件路由
    const routingMap: Record<string, string> = {
      [ReActNode.Think]: ReActNode.Think,
      [ReActNode.Reflect]: ReActNode.Reflect,
      END: END as any,
    };
    for (const agentConfig of this.agentConfigs) {
      const nodeName = agentNodeName(agentConfig.id);
      routingMap[nodeName] = nodeName;
    }
    (workflow as any).addConditionalEdges(ReActNode.Think, routeAfterThink, routingMap);

    // Agent → Think（循环）
    for (const agentConfig of this.agentConfigs) {
      (workflow as any).addEdge(agentNodeName(agentConfig.id), ReActNode.Think);
    }

    // Reflect → END
    (workflow as any).addEdge(ReActNode.Reflect, END);

    const checkpointer = await this.agentSaver.getCheckpointer();
    return workflow.compile({ checkpointer });
  }

  /**
   * 检查是否有等待用户确认的中断状态
   */
  private async getExistingState(): Promise<ReActState | null> {
    try {
      const checkpointer = await this.agentSaver.getCheckpointer();
      const config = { configurable: { thread_id: this.threadId } };
      const checkpoint = await checkpointer.get(config);
      if (checkpoint?.channel_values) {
        const values = checkpoint.channel_values as any;
        return values.reactState || null;
      }
    } catch {
      // 没有已有状态，正常
    }
    return null;
  }

  /**
   * 流式执行 ReAct 任务
   */
  async stream(
    query: string,
    callback: IAgentCallback
  ): Promise<void> {
    try {
      const { onMessage, ...subCallback } = callback;
      const graph = await this.createGraph(subCallback);

      // 检查是否从 waitForUser 恢复
      const existingState = await this.getExistingState();
      const isResuming = existingState?.waitingForUser === true;

      let inputState: any;
      if (isResuming) {
        // 恢复模式：只发送用户的新消息，让 checkpointer 恢复其余状态
        logger.info(`ReAct 恢复 | 用户: ${this.userId} | 用户回复: ${query.substring(0, 80)}`);
        inputState = {
          messages: [new HumanMessage(query)],
        };
      } else {
        // 新任务模式
      const agentIds = this.agentConfigs.map(a => a.id).join(', ');
      logger.info(`ReAct 开始 | 用户: ${this.userId} | Agents: [${agentIds}] | 最大迭代: ${this.maxIterations} | 查询: ${query.substring(0, 80)}`);
        inputState = {
          messages: [new HumanMessage(query)],
          reactState: {
            goal: query,
            currentStep: null,
            steps: [],
            isComplete: false,
            waitingForUser: false,
            maxIterations: this.maxIterations,
            currentIteration: 0
          } as ReActState,
          agentConfigs: this.agentConfigs
        };
      }

      const recursionLimit = this.maxIterations * 4 + 10;

      const stream = await graph.stream(
        inputState,
        {
          streamMode: "updates",
          recursionLimit,
          configurable: { thread_id: this.threadId }
        }
      );

      for await (const update of stream) {
        for (const [_nodeName, nodeOutput] of Object.entries(update)) {
          const output = nodeOutput as any;
          const messages = output.messages || [];

          for (const message of messages) {
            if (message instanceof HumanMessage) continue;
            const messageChunk = this.convertToMessageChunk(message);
            if (messageChunk) {
              await onMessage?.(messageChunk);
            }
          }
        }
      }

      logger.info("ReAct 完成");
    } catch (error: any) {
      logger.error(`ReAct 失败 - ${error.message}`);
      throw error;
    }
  }

  /**
   * 将 BaseMessage 转换为 AgentMessage 格式
   */
  private convertToMessageChunk(message: BaseMessage): AgentMessage | null {
    if (message instanceof AIMessage || message instanceof AIMessageChunk) {
      return {
        type: MessageChunkType.AI,
        content: message.content as string,
        tool_calls: []
      };
    }
    return null;
  }

  /**
   * 释放资源
   */
  async dispose() {
    // ReActService 不持有需要释放的资源，agentSaver 由上层管理
  }
}
