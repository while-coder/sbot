import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, ServiceContainer, T_StaticSystemPrompts, T_DynamicSystemPrompts, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ModelCallTimeout, T_ToolOverflowDir, T_ChannelSessionId, truncate, formatError } from "../../Core";
import { contentToString } from "../../Utils/contentUtils";
import { IAgentSaverService, TaskBackedSaver, ConversationCompactor, IConversationCompactor, ContentPartType, type MessageContent } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { type AgentServiceBase, IAgentCallback, AgentSubNode, CreateAgentFn, T_CreateAgent, MessageRole, ChatMessage } from "../AgentServiceBase";
import { IAgentPlugin, type AgentPluginContext } from "../Plugins";
import { IMemoryService } from "../../Memory";
import { IAgentToolService } from "../../AgentTool";
import { SingleAgentService } from "../Single/SingleAgentService";
import { createDispatchTaskTool, createListTasksTool, TaskContextMode, TaskStatus, type RunDispatchTaskFn, type TaskInfo } from "../../Tools";
import { MCPContentType, createTextContent, createImageContent, /* createAudioContent, */ createErrorResult, type MCPContent } from "../../Tools/Core";
import { v4 as uuidv4 } from "uuid";

// ── Tokens ────────────────────────────────────────────────────

export const T_AgentSubNodes = Symbol("scorpio:T_AgentSubNodes");
export const T_ThinkModelService = Symbol("scorpio:T_ThinkModelService");
/** 当前 ReAct 节点在派生树中的深度（根编排者为 0）。子容器注入 parentDepth+1。 */
export const T_SpawnDepth = Symbol("scorpio:T_SpawnDepth");

/** 子任务注册表的一条记录（含完整字段，对外经 TaskInfo 截断）。 */
interface TaskRecord {
  agentId: string;
  name?: string;
  status: TaskStatus;
  firstTask: string;
  lastSummary?: string;
  turns: number;
  updatedAt: number;
}

// ── ReActAgentService ─────────────────────────────────────────

/**
 * ReAct 多 Agent 编排服务，继承 SingleAgentService。
 *
 * 将子 Agent 封装为工具，由 thinkModel 驱动标准的 agent → tools → agent 循环。
 * 重写 buildSystemMessage / buildTools，其余流程（saver、StateGraph 循环）复用父类。
 */
export class ReActAgentService extends SingleAgentService {
  /** contextMode:state 注入的父对话消息条数上限 */
  private static readonly STATE_CONTEXT_MESSAGES = 8;
  /** contextMode:state 每条消息的截断长度 */
  private static readonly STATE_CONTEXT_PER_MSG = 1000;
  /** 派生树最大深度（根编排者深度 0，故最多嵌套 MAX_SPAWN_DEPTH 层 ReAct）。 */
  private static readonly MAX_SPAWN_DEPTH = 5;

  /** 注册表持久化到编排者 session metadata 的 key */
  private static readonly REGISTRY_META_KEY = 'reactTaskRegistry';

  private agentSubNodes: AgentSubNode[];
  private agentFactory: CreateAgentFn;
  private readonly spawnDepth: number;

  constructor(
    @inject(T_ThinkModelService) thinkModelService: IModelService,
    @inject(T_AgentSubNodes) agentSubNodes: AgentSubNode[],
    @inject(T_CreateAgent) agentFactory: CreateAgentFn,
    @inject(T_ReactSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_ReactSubNodePrompt) private subNodePrompt: string,
    @inject(T_ToolOverflowDir) toolOverflowDir: string,
    @inject(T_ChannelSessionId) channelSessionId: number,
    @inject(T_StaticSystemPrompts, { optional: true }) staticSystemPrompts?: string[],
    @inject(T_DynamicSystemPrompts, { optional: true }) dynamicSystemPrompts?: string[],
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    @inject(T_ModelCallTimeout, { optional: true }) modelCallTimeout?: number,
    @inject(IConversationCompactor, { optional: true }) compactor?: ConversationCompactor,
    @inject(T_SpawnDepth, { optional: true }) spawnDepth?: number,
    @inject(IAgentPlugin, { optional: true }) plugins?: IAgentPlugin[],
  ) {
    super(thinkModelService, toolOverflowDir, channelSessionId, staticSystemPrompts, dynamicSystemPrompts, loggerService, agentSaver, memoryService, toolService, modelCallTimeout, compactor, plugins);
    this.agentSubNodes = agentSubNodes;
    this.agentFactory = agentFactory;
    this.spawnDepth = spawnDepth ?? 0;
  }

  // ── Overrides ────────────────────────────────────────────────

  protected override async buildSystemMessage(ctx: AgentPluginContext, query: MessageContent): Promise<ChatMessage | undefined> {
    const agentsDesc = this.agentSubNodes.map(a => {
      const nameAttr = a.name ? ` name="${a.name}"` : '';
      return `  <agent id="${a.id}"${nameAttr}>${a.desc}</agent>`;
    }).join('\n');
    const reactPrompt = this.systemPromptTemplate.replace('{agents}', agentsDesc);

    const parentMsg = await super.buildSystemMessage(ctx, query);
    if (!parentMsg) {
      return { role: MessageRole.System, content: [{ type: ContentPartType.Text, text: reactPrompt }] };
    }

    const parentContent = parentMsg.content as Array<{ type: string; text: string }>;
    return {
      role: MessageRole.System,
      content: [
        { type: ContentPartType.Text, text: reactPrompt + "\n\n" + parentContent[0].text },
        ...parentContent.slice(1),
      ],
    };
  }

  protected override async buildTools(ctx: AgentPluginContext, callback?: IAgentCallback, signal?: AbortSignal): Promise<StructuredToolInterface[]> {
    if (!callback) return [];
    const { onMessage: _, ...subCallback } = callback;

    const runFn: RunDispatchTaskFn = async ({ agentId, task, systemPrompt, contextMode, thinkId: inputThinkId, taskId: inputTaskId, onCreateThink }) => {
      let agentService: AgentServiceBase | null = null;
      // thinkId 优先用框架预留的那个（配合 onCreateThink 可在子任务执行中就让用户查看思考过程），
      // 无注入时（直接调用 runFn 的场景）自行生成，退化为仅在结果里回传。
      // taskId 由 LLM 传入即续接已有子会话，否则新建一个。
      const resolvedThinkId = inputThinkId ?? uuidv4();
      const resolvedTaskId = inputTaskId ?? uuidv4();

      // P7 派生护栏：超深度直接拒绝，不创建子 agent（防嵌套 ReAct 无限递归）。
      const childDepth = this.spawnDepth + 1;
      if (childDepth > ReActAgentService.MAX_SPAWN_DEPTH) {
        return { ...createErrorResult(`Spawn depth limit reached (max ${ReActAgentService.MAX_SPAWN_DEPTH}); cannot dispatch deeper sub-agents.`), _meta: { thinkId: resolvedThinkId, taskId: resolvedTaskId } };
      }

      // P4 注册表：进入即标记 running（续接则 turns++）。每次从 saver 现取-改-写回。
      const subNode = this.agentSubNodes.find(a => a.id === agentId);
      const reg = await this.readRegistry();
      const prev = reg.get(resolvedTaskId);
      reg.set(resolvedTaskId, {
        agentId,
        name: subNode?.name,
        status: TaskStatus.Running,
        firstTask: prev?.firstTask ?? truncate(task, 200),
        lastSummary: prev?.lastSummary,
        turns: (prev?.turns ?? 0) + 1,
        updatedAt: Date.now(),
      });
      await this.writeRegistry(reg);

      // 声明 think 开启：子 agent 的消息在执行过程中就已实时写入父 saver 的 thinks
      // （见 TaskBackedSaver），但 thinkId 原先只随完成后的 ToolMessage 返回，用户要等子任务
      // 跑完才能查看思考过程。这里在派发前声明一次，框架即把 thinkId/taskId 关联到本次
      // tool_call 通知渠道（见 SingleAgentService.runSingleTool）。放在深度护栏之后，
      // 被拒的派发不会留下悬挂的「思考中」入口。
      await onCreateThink?.(resolvedTaskId);

      try {
        const parentSaver = this.saverService;
        const taskSaver = new TaskBackedSaver(resolvedTaskId, resolvedThinkId, parentSaver);
        const subContainer = new ServiceContainer();
        subContainer.registerInstance(IAgentSaverService, taskSaver);
        // 子任务 SingleAgentService 同样要 T_ChannelSessionId（必传），从父继承一份。
        subContainer.registerInstance(T_ChannelSessionId, this.channelSessionId);
        // P7：把深度透传给子容器，子 ReAct agent 据此继续校验。
        subContainer.registerInstance(T_SpawnDepth, childDepth);
        if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);
        // 故意不透传 memory：抽取（extractFromConversation）无条件随 service 触发，
        // 而子 agent 的 Human 消息是编排者合成的 task 指令、非真实用户输入，抽取会污染记忆/日程。
        // 真实用户内容由编排者自身 turn 末尾统一抽取，子任务无需重复参与。
        // 插件按同一原则区分：抽取类插件默认 inheritToSubAgent=false 不下传，纯检索类显式置 true 才下传。
        const inheritedPlugins = this.plugins.filter(p => p.inheritToSubAgent);
        if (inheritedPlugins.length > 0) subContainer.registerInstance(IAgentPlugin, inheritedPlugins);

        agentService = await this.agentFactory(agentId, subContainer);

        agentService.addStaticSystemPrompts([this.subNodePrompt]);
        if (systemPrompt?.trim()) {
          agentService.addDynamicSystemPrompts([systemPrompt.trim()]);
        }

        // P1 上下文继承：仅新建会话（无 taskId）时按档注入。续接路径忽略 contextMode——子会话已有自己的历史。
        if (!inputTaskId && contextMode === TaskContextMode.State) {
          const snippet = this.buildParentContextSnippet(await this.saverService.getMessages());
          if (snippet) agentService.addDynamicSystemPrompts([snippet]);
        }

        const messages = await agentService.stream(task, subCallback, signal);
        let lastAI: ChatMessage | undefined;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === MessageRole.AI && messages[i].content) { lastAI = messages[i]; break; }
        }
        // P6a 结构化结果：首段为状态行（保留 `task_id: <uuid>` 子串供续接发现），正文紧随其后。
        const textParts: string[] = [];
        const content: MCPContent[] = [];
        content.push(createTextContent(`task_id: ${resolvedTaskId}\nstatus: done\nagent: ${agentId}`));
        if (lastAI) {
          if (typeof lastAI.content === 'string') {
            if (lastAI.content.trim()) { content.push(createTextContent(lastAI.content)); textParts.push(lastAI.content); }
          } else if (Array.isArray(lastAI.content)) {
            for (const part of lastAI.content) {
              if (part.type === MCPContentType.Text && part.text?.trim()) {
                textParts.push(part.text);
                content.push(createTextContent(part.text));
              } else if (part.type === MCPContentType.Image && part.data) {
                content.push(createImageContent(part.data, part.mimeType));
              }
              // } else if (part.type === MCPContentType.Audio && part.data) {
              //   content.push(createAudioContent(part.data, part.mimeType));
              // }
            }
          }
        }
        // P4：成功 → done + 记录摘要
        await this.updateTaskRecord(resolvedTaskId, TaskStatus.Done, textParts.join('\n'));
        return { content, _meta: { thinkId: resolvedThinkId, taskId: resolvedTaskId } };
      } catch (error: any) {
        await this.updateTaskRecord(resolvedTaskId, TaskStatus.Error, formatError(error));
        return { ...createErrorResult(`Execution failed: ${formatError(error)}`), _meta: { thinkId: resolvedThinkId, taskId: resolvedTaskId } };
      } finally {
        await agentService?.dispose();
      }
    };

    const getTasks = async (): Promise<TaskInfo[]> => {
      const reg = await this.readRegistry();
      return [...reg.entries()]
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
        .map(([taskId, r]) => ({
          taskId,
          agentId: r.agentId,
          name: r.name,
          status: r.status,
          firstTask: r.firstTask,
          lastSummary: r.lastSummary,
          turns: r.turns,
        }));
    };

    const agentIds = this.agentSubNodes.map(a => a.id);
    const parentTools = await super.buildTools(ctx, callback, signal);
    return [
      createDispatchTaskTool(agentIds, runFn),
      createListTasksTool(getTasks),
      ...parentTools,
    ];
  }

  /** 从编排者 session metadata 现取注册表（saver 为唯一真相源，容错）。 */
  private async readRegistry(): Promise<Map<string, TaskRecord>> {
    try {
      const raw = await this.saverService.getMetadata(ReActAgentService.REGISTRY_META_KEY);
      if (!raw) return new Map();
      return new Map(JSON.parse(raw) as [string, TaskRecord][]);
    } catch (err: any) {
      this.logger?.warn(`读取子任务注册表失败: ${formatError(err, true)}`);
      return new Map();
    }
  }

  /** 把注册表整表回写 session metadata。 */
  private async writeRegistry(reg: Map<string, TaskRecord>): Promise<void> {
    try {
      await this.saverService.setMetadata(
        ReActAgentService.REGISTRY_META_KEY,
        JSON.stringify([...reg.entries()]),
      );
    } catch (err: any) {
      this.logger?.warn(`写入子任务注册表失败: ${formatError(err, true)}`);
    }
  }

  /** 更新一条子任务记录的状态与摘要（现取-改-写回；记录不存在则忽略）。 */
  private async updateTaskRecord(taskId: string, status: TaskStatus.Done | TaskStatus.Error, summary?: string): Promise<void> {
    const reg = await this.readRegistry();
    const rec = reg.get(taskId);
    if (!rec) return;
    rec.status = status;
    if (summary?.trim()) rec.lastSummary = truncate(summary.trim(), 300);
    rec.updatedAt = Date.now();
    await this.writeRegistry(reg);
  }

  /** 取主对话最近若干条 Human/AI 文本消息，渲染成纯文本快照。
   *  纯文本注入（不进子 saver），故无 tool_calls/ToolMessage 配对约束；tool 消息忽略以降噪。 */
  private buildParentContextSnippet(messages: ChatMessage[]): string | undefined {
    const picked: string[] = [];
    for (let i = messages.length - 1; i >= 0 && picked.length < ReActAgentService.STATE_CONTEXT_MESSAGES; i--) {
      const m = messages[i];
      if (m.role !== MessageRole.Human && m.role !== MessageRole.AI) continue;
      const text = contentToString(m.content).trim();
      if (!text) continue;
      const speaker = m.role === MessageRole.Human ? 'User' : 'Assistant';
      picked.unshift(`${speaker}: ${truncate(text, ReActAgentService.STATE_CONTEXT_PER_MSG)}`);
    }
    if (picked.length === 0) return undefined;
    return `<parent_context>\n以下是主对话的近期上下文，供你理解背景（你是被派遣处理一个子任务的助手，无需复述这些内容）：\n\n${picked.join('\n\n')}\n</parent_context>`;
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await this.modelService.dispose();
  }
}
