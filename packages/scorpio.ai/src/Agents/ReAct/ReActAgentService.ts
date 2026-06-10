import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, ServiceContainer, T_StaticSystemPrompts, T_DynamicSystemPrompts, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc, T_ModelCallTimeout, T_ToolOverflowDir } from "../../Core";
import { INoteService } from "../../Note";
import { IWikiService } from "../../Wiki";
import { IAgentSaverService, TaskBackedSaver, ConversationCompactor, IConversationCompactor, type MessageContent } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { type AgentServiceBase, IAgentCallback, AgentSubNode, CreateAgentFn, T_CreateAgent, MessageRole, ChatMessage } from "../AgentServiceBase";
import { ISkillService } from "../../Skills";
import { IInsightService } from "../../Insight";
import { IAgendaService } from "../../Agenda";
import { IAgentToolService } from "../../AgentTool";
import { SingleAgentService } from "../Single/SingleAgentService";
import { createTaskTool, type RunTaskFn } from "../../Tools";
import { MCPContentType, createTextContent, createImageContent, /* createAudioContent, */ createErrorResult, type MCPContent } from "../../Tools/types";
import { v4 as uuidv4 } from "uuid";

// ── Tokens ────────────────────────────────────────────────────

export const T_AgentSubNodes = Symbol("scorpio:T_AgentSubNodes");
export const T_ThinkModelService = Symbol("scorpio:T_ThinkModelService");

// ── ReActAgentService ─────────────────────────────────────────

/**
 * ReAct 多 Agent 编排服务，继承 SingleAgentService。
 *
 * 将子 Agent 封装为工具，由 thinkModel 驱动标准的 agent → tools → agent 循环。
 * 重写 buildSystemMessage / buildTools，其余流程（saver、note、StateGraph 循环）复用父类。
 */
export class ReActAgentService extends SingleAgentService {
  private agentSubNodes: AgentSubNode[];
  private agentFactory: CreateAgentFn;

  constructor(
    @inject(T_ThinkModelService) thinkModelService: IModelService,
    @inject(T_AgentSubNodes) agentSubNodes: AgentSubNode[],
    @inject(T_CreateAgent) agentFactory: CreateAgentFn,
    @inject(T_ReactSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_ReactSubNodePrompt) private subNodePrompt: string,
    @inject(T_ReactTaskToolDesc) private taskToolDesc: string,
    @inject(ISkillService) skillService: ISkillService,
    @inject(T_StaticSystemPrompts, { optional: true }) staticSystemPrompts?: string[],
    @inject(T_DynamicSystemPrompts, { optional: true }) dynamicSystemPrompts?: string[],
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    @inject(IInsightService, { optional: true }) insightService?: IInsightService,
    @inject(IAgendaService, { optional: true }) agendaService?: IAgendaService,
    @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    @inject(INoteService, { optional: true }) noteServices?: INoteService[],
    @inject(IWikiService, { optional: true }) wikiServices?: IWikiService[],
    @inject(T_ModelCallTimeout, { optional: true }) modelCallTimeout?: number,
    @inject(IConversationCompactor, { optional: true }) compactor?: ConversationCompactor,
    @inject(T_ToolOverflowDir, { optional: true }) toolOverflowDir?: string,
  ) {
    super(thinkModelService, skillService, staticSystemPrompts, dynamicSystemPrompts, loggerService, agentSaver, insightService, agendaService, toolService, noteServices, wikiServices, modelCallTimeout, compactor, toolOverflowDir);
    this.agentSubNodes = agentSubNodes;
    this.agentFactory = agentFactory;
  }

  // ── Overrides ────────────────────────────────────────────────

  protected override async buildSystemMessage(query: MessageContent): Promise<ChatMessage | undefined> {
    const agentsDesc = this.agentSubNodes.map(a => {
      const nameAttr = a.name ? ` name="${a.name}"` : '';
      return `  <agent id="${a.id}"${nameAttr}>${a.desc}</agent>`;
    }).join('\n');
    const reactPrompt = this.systemPromptTemplate.replace('{agents}', agentsDesc);

    const parentMsg = await super.buildSystemMessage(query);
    if (!parentMsg) {
      return { role: MessageRole.System, content: [{ type: "text", text: reactPrompt }] };
    }

    const parentContent = parentMsg.content as Array<{ type: string; text: string }>;
    return {
      role: MessageRole.System,
      content: [
        { type: "text", text: reactPrompt + "\n\n" + parentContent[0].text },
        ...parentContent.slice(1),
      ],
    };
  }

  protected override async buildTools(callback?: IAgentCallback, signal?: AbortSignal): Promise<StructuredToolInterface[]> {
    if (!callback) return [];
    const { onMessage: _, ...subCallback } = callback;

    const runFn: RunTaskFn = async ({ agentId, task, systemPrompt, taskId }) => {
      let agentService: AgentServiceBase | null = null;
      const thinkId = uuidv4();
      const resolvedTaskId = taskId ?? uuidv4();
      try {
        const parentSaver = this.saverService;
        const taskSaver = new TaskBackedSaver(resolvedTaskId, thinkId, parentSaver);
        const subContainer = new ServiceContainer();
        subContainer.registerInstance(IAgentSaverService, taskSaver);
        if (this.noteServices.length > 0) subContainer.registerInstance(INoteService, this.noteServices);
        if (this.wikiServices.length > 0) subContainer.registerInstance(IWikiService, this.wikiServices);
        if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);

        agentService = await this.agentFactory(agentId, subContainer);

        agentService.addStaticSystemPrompts([this.subNodePrompt]);
        if (systemPrompt?.trim()) {
          agentService.addDynamicSystemPrompts([systemPrompt.trim()]);
        }

        const messages = await agentService.stream(task, subCallback, signal);
        let lastAI: ChatMessage | undefined;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === MessageRole.AI && messages[i].content) { lastAI = messages[i]; break; }
        }
        const content: MCPContent[] = [];
        // 把 task_id 作为首段文本注入，让 LLM 在后续调用中可显式传 taskId 续接
        // 使用方式由 _task 工具的 schema/desc 和 react_task.txt 教学，不在此处重复
        content.push(createTextContent(`task_id: ${resolvedTaskId}`));
        if (lastAI) {
          if (typeof lastAI.content === 'string') {
            if (lastAI.content.trim()) content.push(createTextContent(lastAI.content));
          } else if (Array.isArray(lastAI.content)) {
            for (const part of lastAI.content) {
              if (part.type === MCPContentType.Text && part.text?.trim()) {
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
        return { content, _meta: { thinkId, taskId: resolvedTaskId } };
      } catch (error: any) {
        return { ...createErrorResult(`Execution failed: ${error.message}`), _meta: { thinkId, taskId: resolvedTaskId } };
      } finally {
        await agentService?.dispose();
      }
    };

    const agentIds = this.agentSubNodes.map(a => a.id);
    const parentTools = await super.buildTools(callback, signal);
    return [createTaskTool(agentIds, runFn, this.taskToolDesc), ...parentTools];
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await this.modelService.dispose();
  }
}
