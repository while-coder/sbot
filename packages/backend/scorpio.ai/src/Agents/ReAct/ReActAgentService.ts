import { createAgentTool, type AgentTool } from "scorpio.llm";
import { z } from "zod";
import { inject, ServiceContainer, T_StaticSystemPrompts, T_DynamicSystemPrompts, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ModelCallTimeout, T_ToolOverflowDir, T_ChannelSessionId, truncate, formatError } from "../../Core";
import { contentToString } from "../../Utils/contentUtils";
import { readWorkspaceImage } from "../../Utils/workspaceImage";
import { readSavedAttachmentImage } from "../../Utils/messageAttachments";
import path from "node:path";
import { IAgentSaverService, TaskBackedSaver, ContentPartType, type ContentPart, type MessageContent } from "scorpio.saver";
import { ConversationCompactor, IConversationCompactor } from "../../Conversation";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { type AgentServiceBase, IAgentCallback, AgentSubNode, CreateAgentFn, T_CreateAgent, MessageRole, ChatMessage } from "../AgentServiceBase";
import { IAgentPlugin, type AgentPluginContext } from "../Plugins";
import { IAgentToolService } from "../../AgentTool";
import { SingleAgentService } from "../Single/SingleAgentService";
import { TurnSteering } from "../TurnSteering";
import { createSpawnAgentTool, SPAWN_AGENT_TOOL_NAME, TaskContextMode, type RunDispatchTaskArgs } from "../../Tools";
import { subAgentImagePathsSchema } from "../../Tools/Task/DispatchTaskTool";
import { MCPContentType, createTextContent, createImageContent, createErrorResult, type MCPContent, type MCPToolResult } from "../../Tools/Core";
import { v4 as uuidv4 } from "uuid";

// ── Tokens ────────────────────────────────────────────────────

export const T_AgentSubNodes = Symbol("scorpio:T_AgentSubNodes");
export const T_ThinkModelService = Symbol("scorpio:T_ThinkModelService");
export const T_ReActWorkPath = Symbol("scorpio:T_ReActWorkPath");
/** 当前 ReAct 节点在派生树中的深度（根编排者为 0）。子容器注入 parentDepth+1。 */
export const T_SpawnDepth = Symbol("scorpio:T_SpawnDepth");

enum TaskStatus {
  Running = 'running',
  Done = 'done',
  Error = 'error',
  Closed = 'closed',
}

const LIFECYCLE_TOOLS = new Set([SPAWN_AGENT_TOOL_NAME, 'send_input', 'wait_agent', 'close_agent']);
const MAX_ACTIVE_AGENTS = 6;

interface ActiveTask {
  agentId: string;
  controller: AbortController;
  running: boolean;
  completion: Promise<void>;
  steering?: { input: TurnSteering; thinkId: string };
  result?: MCPToolResult;
}

/** 子任务注册表中用于续接的记录。 */
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
  private readonly tasks = new Map<string, ActiveTask>();
  private registryOperation = Promise.resolve();
  private disposing = false;

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
    @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    @inject(T_ModelCallTimeout, { optional: true }) modelCallTimeout?: number,
    @inject(IConversationCompactor, { optional: true }) compactor?: ConversationCompactor,
    @inject(T_SpawnDepth, { optional: true }) spawnDepth?: number,
    @inject(IAgentPlugin, { optional: true }) plugins?: IAgentPlugin[],
    @inject(T_ReActWorkPath, { optional: true }) private readonly workPath?: string,
  ) {
    super(thinkModelService, toolOverflowDir, channelSessionId, staticSystemPrompts, dynamicSystemPrompts, loggerService, agentSaver, toolService, modelCallTimeout, compactor, plugins);
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
    const workflow = this.canSpawn()
      ? 'spawn_agent returns a taskId immediately. Continue independent work or call wait_agent for results. Use send_input for follow-ups and collect required results before the final answer. Use imagePaths with spawn_agent or send_input to attach images by workspace-relative path or by exact attachment filePath from this conversation.'
      : 'Sub-agent tools are unavailable at this depth. Complete the assigned work directly.';
    const reactPrompt = this.systemPromptTemplate.replace('{agents}', agentsDesc) + '\n\n' + workflow;

    const parentMsg = await super.buildSystemMessage(ctx, query);
    const parentContent = (parentMsg?.content ?? []) as Array<{ type: string; text: string }>;
    const content = [
      { type: ContentPartType.Text, text: parentContent[0] ? reactPrompt + "\n\n" + parentContent[0].text : reactPrompt },
      ...parentContent.slice(1),
    ];
    return {
      role: MessageRole.System,
      content,
    };
  }

  protected override async buildTools(ctx: AgentPluginContext, callback?: IAgentCallback, signal?: AbortSignal): Promise<AgentTool[]> {
    if (!callback) return [];
    const { onMessage: _, onStreamMessage: _stream, steering: _parentSteering, ...subCallback } = callback;

    const runTask = async ({
      agentId, task, systemPrompt, contextMode, thinkId: resolvedThinkId, taskId: resolvedTaskId,
    }: RunDispatchTaskArgs & { taskId: string; thinkId: string }, input: MessageContent, resume: boolean, taskSignal: AbortSignal, active: ActiveTask): Promise<MCPToolResult> => {
      let agentService: AgentServiceBase | null = null;
      const subNode = this.agentSubNodes.find(a => a.id === agentId);
      await this.changeRegistry(reg => {
        const prev = reg.get(resolvedTaskId);
        reg.set(resolvedTaskId, {
          agentId, name: subNode?.name, status: TaskStatus.Running,
          firstTask: prev?.firstTask ?? truncate(task, 200),
          lastSummary: prev?.lastSummary, turns: (prev?.turns ?? 0) + 1, updatedAt: Date.now(),
        });
      });

      try {
        taskSignal.throwIfAborted();
        const parentSaver = this.saverService;
        const taskSaver = new TaskBackedSaver(resolvedTaskId, resolvedThinkId, parentSaver);
        const subContainer = new ServiceContainer();
        subContainer.registerInstance(IAgentSaverService, taskSaver);
        // 子任务 SingleAgentService 同样要 T_ChannelSessionId（必传），从父继承一份。
        subContainer.registerInstance(T_ChannelSessionId, this.channelSessionId);
        // P7：把深度透传给子容器，子 ReAct agent 据此继续校验。
        subContainer.registerInstance(T_SpawnDepth, this.spawnDepth + 1);
        if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);
        // 故意不透传 memory：抽取（extractFromConversation）无条件随 service 触发，
        // 而子 agent 的 Human 消息是编排者合成的 task 指令、非真实用户输入，抽取会污染记忆。
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
        if (!resume && contextMode === TaskContextMode.State) {
          const snippet = this.buildParentContextSnippet(await this.saverService.getMessages());
          if (snippet) agentService.addDynamicSystemPrompts([snippet]);
        }

        taskSignal.throwIfAborted();
        const steering = agentService instanceof SingleAgentService ? new TurnSteering() : undefined;
        if (steering) active.steering = { input: steering, thinkId: resolvedThinkId };
        const messages = await agentService.stream(input, { ...subCallback, steering }, taskSignal);
        taskSignal.throwIfAborted();
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
        const status = taskSignal.aborted ? TaskStatus.Closed : TaskStatus.Error;
        await this.updateTaskRecord(resolvedTaskId, status, formatError(error));
        return { ...createErrorResult(`task_id: ${resolvedTaskId}\nstatus: ${status}\n${formatError(error)}`), _meta: { thinkId: resolvedThinkId, taskId: resolvedTaskId } };
      } finally {
        active.steering?.input.close();
        active.steering = undefined;
        await agentService?.dispose();
      }
    };

    const agentIds = this.agentSubNodes.map(a => a.id);
    const parentTools = await super.buildTools(ctx, callback, signal);
    if (!this.canSpawn()) {
      return parentTools;
    }

    const dispatch = async (args: RunDispatchTaskArgs, followUp: boolean): Promise<MCPToolResult> => {
      const images: ContentPart[] = [];
      for (const imagePath of new Set(args.imagePaths)) {
        try {
          const image = path.isAbsolute(imagePath) || path.win32.isAbsolute(imagePath)
            ? await readSavedAttachmentImage(this.saverService, imagePath)
            : await readWorkspaceImage(this.workPath, imagePath);
          images.push({ type: ContentPartType.Text, text: `Image file: ${imagePath}` }, image);
        } catch (error) {
          return createErrorResult(`Could not attach "${imagePath}": ${formatError(error)}`);
        }
      }
      const input: MessageContent = images.length
        ? [{ type: ContentPartType.Text, text: args.task }, ...images]
        : args.task;
      const resume = args.taskId !== undefined;
      const taskId = args.taskId ?? uuidv4();
      const thinkId = args.thinkId ?? uuidv4();
      if (resume && !this.tasks.has(taskId)) {
        await this.registryOperation;
        const previous = (await this.readRegistry()).get(taskId);
        if (previous ? previous.agentId !== args.agentId : !(await this.saverService.getTaskMessages(taskId)).length) {
          return createErrorResult('Unknown taskId for this sub-agent.');
        }
      }
      if (this.disposing || signal?.aborted) return createErrorResult('Agent execution is ending.');
      const active: ActiveTask = this.tasks.get(taskId) ?? {
        agentId: args.agentId, controller: new AbortController(), running: false, completion: Promise.resolve(),
      };
      if (active.agentId !== args.agentId) return createErrorResult('This taskId belongs to a different sub-agent.');
      if (active.controller.signal.aborted) return createErrorResult('This sub-agent has been closed.');
      if (active.running) {
        if (!followUp) return createErrorResult('This task is running. Use send_input for a follow-up.');
        const steering = active.steering;
        if (!steering?.input.offer({ prepare: () => input })) {
          return createErrorResult('The sub-agent cannot accept steering during its current run.');
        }
        return { content: [createTextContent(`task_id: ${taskId}\nstatus: steering\nagent: ${args.agentId}`)], _meta: { thinkId: steering.thinkId, taskId } };
      }
      if ([...this.tasks.values()].filter(task => task.running).length >= MAX_ACTIVE_AGENTS) {
        return createErrorResult('Too many active sub-agents. Wait for a result before starting another.');
      }

      this.tasks.set(taskId, active);
      const taskSignal = signal ? AbortSignal.any([signal, active.controller.signal]) : active.controller.signal;
      const announcement = Promise.resolve().then(() => args.onCreateThink?.(taskId));
      active.running = true;
      active.completion = (async () => {
        try {
          await announcement;
          if (!taskSignal.aborted) {
            active.result = await runTask({ ...args, taskId, thinkId }, input, resume, taskSignal, active);
          }
        } catch (error) {
          active.result = createErrorResult(`task_id: ${taskId}\nstatus: error\n${formatError(error)}`);
        } finally {
          active.running = false;
        }
      })();
      await announcement;
      return { content: [createTextContent(`task_id: ${taskId}\nstatus: running\nagent: ${args.agentId}`)], _meta: { thinkId, taskId } };
    };

    return [
      createSpawnAgentTool(agentIds, args => dispatch(args, false)),
      createAgentTool({
        name: 'send_input',
        description: 'Steer a running native sub-agent at the next safe model or tool boundary, or give an idle sub-agent a new instruction.',
        schema: z.object({
          taskId: z.string().uuid(), message: z.string().trim().min(1),
          imagePaths: subAgentImagePathsSchema,
        }),
        func: async ({ taskId, message, imagePaths }, config) => {
          const active = this.tasks.get(taskId);
          if (!active) return createErrorResult('Unknown taskId in this turn. Use spawn_agent to resume saved tasks.');
          return dispatch({ taskId, agentId: active.agentId, task: message, imagePaths, thinkId: config?.thinkId, onCreateThink: config?.onCreateThink }, true);
        },
      }),
      createAgentTool({
        name: 'wait_agent',
        description: 'Wait for the given sub-agents to finish and return their latest results. Reports running tasks if the timeout expires.',
        schema: z.object({
          taskIds: z.array(z.string().uuid()).min(1).max(MAX_ACTIVE_AGENTS),
          timeoutMs: z.number().int().positive().max(60_000).default(15_000),
        }),
        func: async ({ taskIds, timeoutMs }) => this.waitForTasks(taskIds, timeoutMs, signal),
      }),
      createAgentTool({
        name: 'close_agent',
        description: 'Cancel the current run of a sub-agent. Its conversation history is saved.',
        schema: z.object({ taskId: z.string().uuid() }),
        func: async ({ taskId }) => {
          const active = this.tasks.get(taskId);
          if (!active) return createErrorResult('Unknown taskId in this turn.');
          active.controller.abort();
          await active.completion;
          await this.updateTaskRecord(taskId, TaskStatus.Closed);
          return { content: [createTextContent(`task_id: ${taskId}\nstatus: closed`)] };
        },
      }),
      ...parentTools.filter(tool => !LIFECYCLE_TOOLS.has(tool.name)),
    ];
  }

  protected override isInternalTool(name: string): boolean {
    return this.canSpawn() && LIFECYCLE_TOOLS.has(name);
  }

  private canSpawn(): boolean {
    return this.agentSubNodes.length > 0 && this.spawnDepth < ReActAgentService.MAX_SPAWN_DEPTH;
  }

  private async waitForTasks(taskIds: string[], timeoutMs: number, signal?: AbortSignal): Promise<MCPToolResult> {
    const selected: { taskId: string; task: ActiveTask }[] = [];
    for (const taskId of new Set(taskIds)) {
      const task = this.tasks.get(taskId);
      if (!task) return createErrorResult(`Unknown taskId in this turn: ${taskId}`);
      selected.push({ taskId, task });
    }
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const deadline = new Promise<void>(resolve => {
        timer = setTimeout(resolve, timeoutMs);
        onAbort = () => resolve();
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) resolve();
      });
      await Promise.race([Promise.all(selected.map(({ task }) => task.completion)), deadline]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
    return {
      content: selected.flatMap(({ taskId, task }) => {
        if (task.controller.signal.aborted) return [createTextContent(`task_id: ${taskId}\nstatus: closed`)];
        if (task.running || !task.result) return [createTextContent(`task_id: ${taskId}\nstatus: running`)];
        return task.result.content;
      }),
    };
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
  private updateTaskRecord(taskId: string, status: TaskStatus, summary?: string): Promise<void> {
    return this.changeRegistry(reg => {
      const rec = reg.get(taskId);
      if (!rec) return;
      rec.status = status;
      if (summary?.trim()) rec.lastSummary = truncate(summary.trim(), 300);
      rec.updatedAt = Date.now();
    });
  }

  private changeRegistry(change: (registry: Map<string, TaskRecord>) => void): Promise<void> {
    const operation = this.registryOperation.then(async () => {
      const registry = await this.readRegistry();
      change(registry);
      await this.writeRegistry(registry);
    });
    this.registryOperation = operation.catch(error => {
      this.logger?.warn(`更新子任务注册表失败: ${formatError(error, true)}`);
    });
    return operation;
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
    this.disposing = true;
    for (const task of this.tasks.values()) {
      if (task.running) task.controller.abort();
    }
    await Promise.allSettled([...this.tasks.values()].map(task => task.completion));
    this.tasks.clear();
    await super.dispose();
    await this.modelService.dispose();
  }
}
