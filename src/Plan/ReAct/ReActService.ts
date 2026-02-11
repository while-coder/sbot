import { HumanMessage, AIMessage, AIMessageChunk, BaseMessage } from "langchain";
import { StateGraph, START, END } from '@langchain/langgraph';
import { ReActAnnotation, ReActState, ReActNode, agentNodeName } from './ReActAnnotation.js';
import { thinkNode, routeAfterThink, observeNode, reflectNode } from './ReActNodes.js';
import { AgentConfig } from '../Supervisor/SupervisorAnnotation.js';
import { AgentService, OnMessageCallback, OnStreamMessageCallback, ExecuteToolCallback, ConvertImagesCallback, MessageChunkType, AgentMessage } from 'scorpio.ai';
import { FilteredAgentToolService } from '../FilteredAgentToolService.js';
import { IAgentSaverService, IModelService, ISkillService, IMemoryService, IAgentToolService, inject, ServiceContainer } from 'scorpio.ai';
import { SharedAgentSaver } from '../SharedAgentSaver.js';
import { LoggerService } from '../../LoggerService.js';

const logger = LoggerService.getLogger("ReActService.ts");

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
    onStreamMessage?: OnStreamMessageCallback,
    executeTool?: ExecuteToolCallback,
    convertImages?: ConvertImagesCallback
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
          userId: this.userId,
          threadId: `${this.threadId}_react_${agentConfig.id}_${currentStep.id}`
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
          async (message: AgentMessage) => {
            if (message.type === MessageChunkType.AI && message.content) {
              actionResult += message.content;
              messages.push(new AIMessage(message.content));
            }
          },
          onStreamMessage,
          executeTool,
          convertImages
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
    onStreamMessage?: OnStreamMessageCallback,
    executeTool?: ExecuteToolCallback,
    convertImages?: ConvertImagesCallback
  ) {
    const workflow = new StateGraph(ReActAnnotation);

    // 添加节点
    workflow.addNode(ReActNode.Think, (state) => thinkNode(state, this.modelService));
    workflow.addNode(ReActNode.Reflect, (state) => reflectNode(state, this.modelService));

    for (const agentConfig of this.agentConfigs) {
      const nodeName = agentNodeName(agentConfig.id);
      const nodeFunc = await this.createSubAgentNode(
        agentConfig, onStreamMessage, executeTool, convertImages
      );
      workflow.addNode(nodeName, nodeFunc);
    }

    // 边：START → Think
    (workflow as any).addEdge(START, ReActNode.Think);

    // Think 的条件路由（直接从 Think 出发，不再需要 Router 空节点）
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
    onMessage: OnMessageCallback,
    onStreamMessage?: OnStreamMessageCallback,
    executeTool?: ExecuteToolCallback,
    convertImages?: ConvertImagesCallback
  ): Promise<void> {
    try {
      const graph = await this.createGraph(onStreamMessage, executeTool, convertImages);

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
              await onMessage(messageChunk);
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
