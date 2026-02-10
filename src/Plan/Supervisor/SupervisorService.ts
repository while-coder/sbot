import { HumanMessage, AIMessage, AIMessageChunk, BaseMessage } from "langchain";
import { StateGraph, START, END } from '@langchain/langgraph';
import { SupervisorAnnotation, AgentConfig, SubTask, TaskStatus, ExecutionPlan } from './SupervisorAnnotation.js';
import { planNode, supervisorNode, aggregatorNode } from './SupervisorNodes.js';
import { AgentService, OnMessageCallback, OnStreamMessageCallback, ExecuteToolCallback, ConvertImagesCallback, MessageChunkType, AgentMessage } from 'scorpio.ai';
import { FilteredAgentToolService } from '../FilteredAgentToolService.js';
import { IAgentSaverService, IModelService, ISkillService, IMemoryService, IAgentToolService, inject, ServiceContainer } from 'scorpio.ai';
import { LoggerService } from '../../LoggerService.js';

const logger = LoggerService.getLogger("SupervisorService.ts");

/**
 * 任务状态变化回调类型
 */
export type OnTaskStatusChangeCallback = (
  task: SubTask,
  oldStatus: TaskStatus,
  newStatus: TaskStatus
) => Promise<void>;

/**
 * 计划创建回调类型
 */
export type OnPlanCreatedCallback = (plan: ExecutionPlan) => Promise<void>;

/**
 * Supervisor Agent 服务
 * 实现多 Agent 协同和任务规划功能
 *
 * 注意：此服务使用混合注入模式：
 * - 共享服务通过依赖注入获取
 * - 动态参数（userId, threadId, agentConfigs）通过构造函数参数传递
 */
export class SupervisorService {
  private userId: string;
  private threadId: string;
  private agentConfigs: AgentConfig[];
  private modelService: IModelService;
  private agentSaver: IAgentSaverService;
  private skillService?: ISkillService;
  private memoryService?: IMemoryService;

  constructor(
    userId: string,
    threadId: string,
    agentConfigs: AgentConfig[],
    @inject(IModelService) modelService: IModelService,
    @inject(IAgentSaverService) agentSaver: IAgentSaverService,
    @inject(ISkillService, { optional: true }) skillService?: ISkillService,
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService
  ) {
    this.userId = userId;
    this.threadId = threadId;
    this.agentConfigs = agentConfigs;
    this.modelService = modelService;
    this.agentSaver = agentSaver;
    this.skillService = skillService;
    this.memoryService = memoryService;

    logger.info(`SupervisorService 初始化 - 用户: ${userId}, 线程: ${threadId}, Agent数量: ${agentConfigs.length}`);
  }

  /**
   * 创建 Sub-Agent 节点函数
   * 复用现有 AgentService 逻辑
   */
  private async createSubAgentNode(
    agentConfig: AgentConfig,
    onStreamMessage?: OnStreamMessageCallback,
    executeTool?: ExecuteToolCallback,
    convertImages?: ConvertImagesCallback
  ) {
    return async (state: typeof SupervisorAnnotation.State) => {
      const currentTask = state.currentTask;
      if (!currentTask) {
        logger.warn(`Sub-Agent ${agentConfig.type}: 当前任务为空`);
        return {};
      }

      logger.info(`Sub-Agent ${agentConfig.type}: 开始执行任务 ${currentTask.id}`);

      try {
        // 为这个 Sub-Agent 创建独立的 ServiceContainer
        const subContainer = new ServiceContainer();

        // 注册共享服务（复用父级服务）
        subContainer.registerInstance(IModelService, this.modelService);
        subContainer.registerInstance(IAgentSaverService, this.agentSaver);

        // 注册可选服务（如果存在）
        if (this.skillService) {
          subContainer.registerInstance(ISkillService, this.skillService);
        }
        if (this.memoryService) {
          subContainer.registerInstance(IMemoryService, this.memoryService);
        }

        // 为这个 Sub-Agent 创建独立的工具服务并注册
        const filteredToolService = new FilteredAgentToolService(
          agentConfig.tools,
          this.skillService,
          this.memoryService
        );
        subContainer.registerInstance(IAgentToolService, filteredToolService);

        // 使用 ServiceContainer 创建 AgentService 实例
        subContainer.registerWithArgs(AgentService, {
          userId: this.userId,
          threadId: `${this.threadId}_${agentConfig.type}_${currentTask.id}`
        });
        const agentService = await subContainer.resolve(AgentService);

        // 构建任务特定的 prompt
        const taskPrompt = agentConfig.systemPrompt
          ? `${agentConfig.systemPrompt}\n\n当前任务: ${currentTask.description}`
          : `当前任务: ${currentTask.description}`;

        // 收集执行结果
        let taskResult = "";
        const messages: BaseMessage[] = [];

        // 执行任务
        await agentService.stream(
          taskPrompt,
          async (message: AgentMessage) => {
            // 收集 AI 响应
            if (message.type === MessageChunkType.AI && message.content) {
              taskResult += message.content;
              messages.push(new AIMessage(message.content));
            }
          },
          onStreamMessage,
          executeTool,
          convertImages
        );

        // 更新任务结果
        currentTask.status = TaskStatus.COMPLETED;
        currentTask.result = taskResult || "任务完成";
        currentTask.assignedAgent = agentConfig.id;

        logger.info(`Sub-Agent ${agentConfig.type}: 任务 ${currentTask.id} 执行完成`);

        return {
          currentTask: currentTask,
          messages: messages,
          taskHistory: [{
            taskId: currentTask.id,
            timestamp: Date.now(),
            event: `Task ${currentTask.id} completed by ${agentConfig.type}`
          }]
        };
      } catch (error: any) {
        logger.error(`Sub-Agent ${agentConfig.type}: 任务 ${currentTask.id} 执行失败 - ${error.message}`);

        // 更新任务状态为失败
        currentTask.status = TaskStatus.FAILED;
        currentTask.error = error.message;

        return {
          currentTask: currentTask,
          messages: [new AIMessage(`任务 ${currentTask.id} 执行失败: ${error.message}`)],
          taskHistory: [{
            taskId: currentTask.id,
            timestamp: Date.now(),
            event: `Task ${currentTask.id} failed: ${error.message}`
          }]
        };
      }
    };
  }

  /**
   * 创建 Supervisor 图
   */
  private async createGraph(
    onStreamMessage?: OnStreamMessageCallback,
    executeTool?: ExecuteToolCallback,
    convertImages?: ConvertImagesCallback
  ) {
    const workflow = new StateGraph(SupervisorAnnotation);

    // 添加主要节点，直接使用注入的 modelService
    workflow.addNode("plan", (state) => planNode(state, this.modelService));

    // supervisor 节点只用于路由
    workflow.addNode("supervisor", () => ({}));

    workflow.addNode("aggregator", (state) => aggregatorNode(state, this.modelService));

    // 为每个 Agent 类型创建节点
    for (const agentConfig of this.agentConfigs) {
      const nodeName = `agent_${agentConfig.type}`;
      const nodeFunc = await this.createSubAgentNode(
        agentConfig,
        onStreamMessage,
        executeTool,
        convertImages
      );

      // 包装节点函数，添加 currentTask 设置逻辑
      const wrappedNodeFunc = async (state: typeof SupervisorAnnotation.State) => {
        // 从 plan 中找到当前应该执行的任务
        if (state.plan) {
          const taskForThisAgent = state.plan.tasks.find(
            t => t.status === TaskStatus.IN_PROGRESS && t.agentType === agentConfig.type
          );

          if (taskForThisAgent) {
            // 设置 currentTask
            const stateWithTask = { ...state, currentTask: taskForThisAgent };
            return await nodeFunc(stateWithTask as any);
          }
        }

        return await nodeFunc(state);
      };

      workflow.addNode(nodeName, wrappedNodeFunc);
    }

    // 添加边
    (workflow as any).addEdge(START, "plan");
    (workflow as any).addEdge("plan", "supervisor");

    // 构建条件路由映射
    const routingMap: Record<string, string> = {
      aggregator: "aggregator",
      END: END as any
    };

    // 添加每个 Agent 类型到路由映射
    for (const agentConfig of this.agentConfigs) {
      const nodeName = `agent_${agentConfig.type}`;
      routingMap[nodeName] = nodeName;
    }

    // 条件路由：supervisor 根据任务类型路由到不同 Agent
    (workflow as any).addConditionalEdges("supervisor", supervisorNode, routingMap);

    // 所有 Sub-Agent 完成后返回 supervisor
    for (const agentConfig of this.agentConfigs) {
      (workflow as any).addEdge(`agent_${agentConfig.type}`, "supervisor");
    }

    (workflow as any).addEdge("aggregator", END);

    // 编译图，使用注入的 agentSaver
    const checkpointer = await this.agentSaver.getCheckpointer();

    logger.info("SupervisorService: 图编译完成");

    return workflow.compile({ checkpointer });
  }

  /**
   * 流式执行 Supervisor 任务
   */
  async stream(
    query: string,
    onMessage: OnMessageCallback,
    onStreamMessage?: OnStreamMessageCallback,
    onTaskStatusChange?: OnTaskStatusChangeCallback,
    onPlanCreated?: OnPlanCreatedCallback,
    executeTool?: ExecuteToolCallback,
    convertImages?: ConvertImagesCallback
  ): Promise<void> {
    try {
      logger.info(`SupervisorService: 开始处理查询 - ${query}`);

      // 创建图
      const graph = await this.createGraph(onStreamMessage, executeTool, convertImages);

      // 初始化状态
      const initialState = {
        messages: [new HumanMessage(query)],
        plan: null,
        currentTask: null,
        agentConfigs: this.agentConfigs,
        taskHistory: []
      };

      // 流式执行
      const stream = await graph.stream(
        initialState,
        { streamMode: "updates", configurable: { thread_id: this.threadId } }
      );

      let lastPlan: ExecutionPlan | null = null;

      // 处理流式输出
      for await (const update of stream) {
        for (const [nodeName, nodeOutput] of Object.entries(update)) {
          logger.info(`SupervisorService: 节点 ${nodeName} 输出`);

          const output = nodeOutput as any;
          const messages = output.messages || [];

          // 检查计划是否被创建
          if (output.plan && !lastPlan && onPlanCreated) {
            lastPlan = output.plan as ExecutionPlan;
            if (lastPlan) {
              await onPlanCreated(lastPlan);
            }
          }

          // 检查任务状态变化
          if (output.currentTask && onTaskStatusChange) {
            const currentTask = output.currentTask as SubTask;
            await onTaskStatusChange(currentTask, TaskStatus.IN_PROGRESS, currentTask.status);
          }

          // 转发消息
          for (const message of messages) {
            if (message instanceof HumanMessage) continue;

            const messageChunk = this.convertToMessageChunk(message);
            if (messageChunk) {
              await onMessage(messageChunk);
            }
          }
        }
      }

      logger.info("SupervisorService: 执行完成");
    } catch (error: any) {
      logger.error(`SupervisorService: 执行失败 - ${error.message}`, error.stack);
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
    logger.info("SupervisorService: 释放资源");
  }
}
