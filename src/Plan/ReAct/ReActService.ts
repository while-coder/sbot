import { HumanMessage, AIMessage, AIMessageChunk, BaseMessage } from "langchain";
import { StateGraph, START, END } from '@langchain/langgraph';
import { ReActAnnotation, ReActState, ReActStepType } from './ReActAnnotation.js';
import { thinkNode, routerNode, observeNode, reflectNode } from './ReActNodes.js';
import { AgentConfig } from '../Supervisor/SupervisorAnnotation.js';
import { AgentService, OnMessageCallback, OnStreamMessageCallback, ExecuteToolCallback, ConvertImagesCallback, MessageChunkType, AgentMessage } from 'scorpio.ai';
import { FilteredAgentToolService } from '../FilteredAgentToolService.js';
import { IAgentSaverService, IModelService, ISkillService, IMemoryService, IAgentToolService, inject, ServiceContainer } from 'scorpio.ai';
import { LoggerService } from '../../LoggerService.js';

const logger = LoggerService.getLogger("ReActService.ts");

/**
 * ReAct Agent 服务
 * 实现 ReAct (Reasoning and Acting) 模式的多 Agent 协同
 *
 * ReAct 循环：Think → Act → Observe → (Think → Act → Observe)* → Reflect
 */
export class ReActService {
  private userId: string;
  private threadId: string;
  private agentConfigs: AgentConfig[];
  private modelService: IModelService;
  private agentSaver: IAgentSaverService;
  private skillService?: ISkillService;
  private memoryService?: IMemoryService;
  private maxIterations: number;

  constructor(
    userId: string,
    threadId: string,
    agentConfigs: AgentConfig[],
    @inject(IModelService) modelService: IModelService,
    @inject(IAgentSaverService) agentSaver: IAgentSaverService,
    @inject(ISkillService, { optional: true }) skillService?: ISkillService,
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    maxIterations: number = 5
  ) {
    this.userId = userId;
    this.threadId = threadId;
    this.agentConfigs = agentConfigs;
    this.modelService = modelService;
    this.agentSaver = agentSaver;
    this.skillService = skillService;
    this.memoryService = memoryService;
    this.maxIterations = maxIterations;

    logger.info(`ReActService 初始化 - 用户: ${userId}, 线程: ${threadId}, Agent数量: ${agentConfigs.length}, 最大迭代: ${maxIterations}`);
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
        logger.warn(`ReAct Sub-Agent ${agentConfig.type}: 当前步骤为空`);
        return {};
      }

      const currentStep = reactState.currentStep;
      logger.info(`ReAct Sub-Agent ${agentConfig.type}: 开始执行步骤 ${currentStep.id}`);

      try {
        // 为这个 Sub-Agent 创建独立的 ServiceContainer
        const subContainer = new ServiceContainer();

        // 注册共享服务
        subContainer.registerInstance(IModelService, this.modelService);
        subContainer.registerInstance(IAgentSaverService, this.agentSaver);

        if (this.skillService) {
          subContainer.registerInstance(ISkillService, this.skillService);
        }
        if (this.memoryService) {
          subContainer.registerInstance(IMemoryService, this.memoryService);
        }

        // 为这个 Sub-Agent 创建独立的工具服务
        const filteredToolService = new FilteredAgentToolService(
          agentConfig.tools,
          this.skillService,
          this.memoryService
        );
        subContainer.registerInstance(IAgentToolService, filteredToolService);

        // 使用 ServiceContainer 创建 AgentService
        subContainer.registerWithArgs(AgentService, {
          userId: this.userId,
          threadId: `${this.threadId}_react_${agentConfig.type}_${currentStep.id}`
        });
        const agentService = await subContainer.resolve(AgentService);

        // 构建任务 prompt
        const taskPrompt = agentConfig.systemPrompt
          ? `${agentConfig.systemPrompt}\n\n当前任务: ${currentStep.content}`
          : `当前任务: ${currentStep.content}`;

        // 收集执行结果
        let actionResult = "";
        const messages: BaseMessage[] = [];

        // 执行任务
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

        logger.info(`ReAct Sub-Agent ${agentConfig.type}: 步骤 ${currentStep.id} 执行完成`);

        // 调用 observe 节点记录结果
        const observeResult = await observeNode(state, actionResult || "任务完成");

        return {
          ...observeResult,
          messages: messages
        };
      } catch (error: any) {
        logger.error(`ReAct Sub-Agent ${agentConfig.type}: 步骤 ${currentStep.id} 执行失败 - ${error.message}`);

        // 记录失败结果
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

    // 添加核心节点
    workflow.addNode("think", (state) => thinkNode(state, this.modelService));
    workflow.addNode("router", () => ({})); // 空节点，只用于路由
    workflow.addNode("reflect", (state) => reflectNode(state, this.modelService));

    // 为每个 Agent 类型创建节点
    for (const agentConfig of this.agentConfigs) {
      const nodeName = `agent_${agentConfig.type}`;
      const nodeFunc = await this.createSubAgentNode(
        agentConfig,
        onStreamMessage,
        executeTool,
        convertImages
      );
      workflow.addNode(nodeName, nodeFunc);
    }

    // 添加边
    (workflow as any).addEdge(START, "think");
    (workflow as any).addEdge("think", "router");

    // 构建条件路由映射
    const routingMap: Record<string, string> = {
      think: "think",
      reflect: "reflect",
      END: END as any
    };

    // 添加每个 Agent 类型到路由映射
    for (const agentConfig of this.agentConfigs) {
      const nodeName = `agent_${agentConfig.type}`;
      routingMap[nodeName] = nodeName;
    }

    // 条件路由
    (workflow as any).addConditionalEdges("router", routerNode, routingMap);

    // 所有 Sub-Agent 完成后返回 router 继续循环
    for (const agentConfig of this.agentConfigs) {
      (workflow as any).addEdge(`agent_${agentConfig.type}`, "think");
    }

    (workflow as any).addEdge("reflect", END);

    // 编译图
    const checkpointer = await this.agentSaver.getCheckpointer();
    logger.info("ReActService: 图编译完成");

    return workflow.compile({ checkpointer });
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
      logger.info(`ReActService: 开始处理查询 - ${query}`);

      // 创建图
      const graph = await this.createGraph(onStreamMessage, executeTool, convertImages);

      // 初始化 ReAct 状态
      const initialReActState: ReActState = {
        goal: query,
        currentStep: null,
        steps: [],
        isComplete: false,
        maxIterations: this.maxIterations,
        currentIteration: 0
      };

      // 初始化状态
      const initialState = {
        messages: [new HumanMessage(query)],
        reactState: initialReActState,
        agentConfigs: this.agentConfigs
      };

      // 流式执行
      const stream = await graph.stream(
        initialState,
        { streamMode: "updates", configurable: { thread_id: this.threadId } }
      );

      // 处理流式输出
      for await (const update of stream) {
        for (const [nodeName, nodeOutput] of Object.entries(update)) {
          logger.info(`ReActService: 节点 ${nodeName} 输出`);

          const output = nodeOutput as any;
          const messages = output.messages || [];

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

      logger.info("ReActService: 执行完成");
    } catch (error: any) {
      logger.error(`ReActService: 执行失败 - ${error.message}`, error.stack);
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
    logger.info("ReActService: 释放资源");
  }
}
