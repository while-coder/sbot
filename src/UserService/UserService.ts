import {Util} from "weimingcommons";
import {larkService } from "../LarkService";
import {LarkChatProvider, type ProviderToolMessage} from "../LarkChatProvider";
import axios from "axios";
import {AgentRow, database} from "../Database";
import log4js from "log4js";
import GraphService, {type LangChainMessageChunk} from "../Graph/GraphService";
import {BaseUserService} from "./BaseUserService";
const logger = log4js.getLogger('UserService.js')


function parseChunk2Message(provider: LarkChatProvider, message: LangChainMessageChunk) {
  if (message.type === "ai") {
    if (message.tool_calls?.length > 0) {
      for (const t of message.tool_calls) {
        const toolCall: ProviderToolMessage = { type: "tool", name: t.name, args: t.args };
        provider.tools[t.id] = toolCall;
        provider.messages.push(toolCall);
      }
    } else {
      provider.messages.push({ type: "text", content: message.content });
    }
  } else if (message.type === "tool") {
    const toolCall = provider.tools[message.tool_call_id];
    if (toolCall) {
      toolCall.result = true;
      toolCall.status = message.status;
      toolCall.response = message.content;
    }
  }
  return provider;
}

export class UserService implements BaseUserService {
  static allUsers = new Map<string, UserService>();
  static getUserAgentService(userId: string):UserService {
    if (UserService.allUsers.has(userId)) {
      return UserService.allUsers.get(userId)!;
    }
    const user = new UserService(userId);
    UserService.allUsers.set(userId, user);
    return user;
  }
  isRunning = false;
  private readonly _userId: string;
  agentService: GraphService;
  provider: LarkChatProvider|undefined;
  toolCallId: string | undefined;
  toolCallStatus:"none"|"wait"|"ok"|"cancel" = "none"

  messages = new Map<string, (content: string | undefined, chatId: string) => Promise<string|{header:any,elements:any[]}|void>>();
  actions = new Map<string, (form_value:any, value:any) => Promise<string|void>>();

  get userId(): string { return this._userId; }

  constructor(userId: string) {
    this._userId = userId;
    this.agentService = new GraphService(this)
    this.messages.set("/agent", this.OnAgent.bind(this));
    this.messages.set("/config", this.OnConfig.bind(this));
    this.messages.set("/mcp", this.OnMcp.bind(this));
    this.messages.set("/system", this.OnSystem.bind(this));
    this.messages.set("/clear", this.OnClear.bind(this));
    this.messages.set("/buildtools", this.OnBuildTools.bind(this));
    this.messages.set("/info", this.OnInfo.bind(this));
    this.actions.set("SetConfig", this.OnSetConfig.bind(this))
    this.actions.set("SetAgent", this.OnSetAgent.bind(this))
    this.actions.set("ToolCall", this.OnToolCall.bind(this))
  }

  async OnAgent() {
    let agentConfig = await this.agentService.getAgentConfig();
    const result = await database.findAll<AgentRow>(database.agent, { where: { userid: this.userId } });
    let options:any[] = []
    let initIndex = 0
    for (var i = 0; i < result.length; i++) {
      let text = result[i].name
      if (result[i].id == agentConfig.id) {
        initIndex = i + 1
      }
      options.push({
        text: {  "tag": "plain_text", "content": text },
        value: result[i].name
      })
    }
    return {
      header: {
        "title": {
          "tag": "plain_text",
          "content": "选择智能体"
        },
        "template": "blue",
      },
      elements: [
        {
          "tag": "form",
          "padding": "4px 0px 4px 0px",
          "margin": "0px 0px 0px 0px",
          "name": "Form_Agent",
          "elements": [
            {
              "name": "agent",
              "tag": "select_static",
              "width": "fill",
              initial_index: initIndex,
              "options": options,
            },
            {
              "tag": "input",
              "width": "fill",
              "label": {
                "tag": "plain_text",
                "content": "新建Agent"
              },
              "name": "newAgent",
            },
            {
              "tag": "button",
              "text": {
                "tag": "plain_text",
                "content": "保存"
              },
              "type": "primary_filled",
              "width": "fill",
              "size": "medium",
              "behaviors": [
                {
                  "type": "callback",
                  "value": {
                    code: "SetAgent",
                    data: {}
                  }
                }
              ],
              "form_action_type": "submit",
              "name": "SubmitSetAgent",
            },
          ],
        }
      ]
    }
  }
  async OnConfig() {
    const agentConfig = await this.agentService.getAgentConfig();
    let config = JSON.parse(agentConfig.config!);
    return {
      header: {
        "title": {
          "tag": "plain_text",
          "content": `设置AI参数:${agentConfig.name}`
        },
        "template": "blue",
      },
      elements: [
        {
          "tag": "form",
          "padding": "4px 0px 4px 0px",
          "margin": "0px 0px 0px 0px",
          "name": "Form_Config",
          "elements": [
            {
              "tag": "input",
              "default_value": config?.url ?? "",
              "width": "fill",
              "label": {
                "tag": "plain_text",
                "content": "OpenAI Url"
              },
              "label_position": "top",
              "name": "url",
            },
            {
              "tag": "input",
              "default_value": config?.apiKey ?? "",
              "width": "fill",
              "label": {
                "tag": "plain_text",
                "content": "OpenAI ApiKey"
              },
              "name": "apiKey",
            },
            {
              "tag": "input",
              "default_value": config?.model ?? "",
              "width": "fill",
              "label": {
                "tag": "plain_text",
                "content": "OpenAI Model"
              },
              "name": "model",
            },
            {
              "tag": "input",
              "default_value": config?.toolTimeout ?? "30",
              "width": "fill",
              "label": {
                "tag": "plain_text",
                "content": "允许Tool超时"
              },
              "name": "toolTimeout",
            },
            {
              "tag": "button",
              "text": {
                "tag": "plain_text",
                "content": "保存"
              },
              "type": "primary_filled",
              "width": "fill",
              "size": "medium",
              "behaviors": [
                {
                  "type": "callback",
                  "value": {
                    code: "SetConfig",
                    data: {
                      id: agentConfig.id
                    }
                  }
                }
              ],
              "form_action_type": "submit",
              "name": "SubmitSetConfig",
            },
          ],
        }
      ]
    }
  }
  async OnMcp(content?: string) {
    const agentConfig = await this.agentService.getAgentConfig();
    if (Util.isNullOrEmpty(content)) {
      let ret = `当前配置:
\`\`\`
${agentConfig.mcp}
\`\`\`
配置模板:
\`\`\`
${JSON.stringify({ tools: { type: "xxx", command: "xxx", url: "xxx", args: [], headers: {} } }, null, 2)}
\`\`\``;

      let tools = await this.agentService.createTools() as any[];
      ret += `
## Tool总数量:${tools.length}`
      for (const t of tools) {
        ret += `
---
* ${t.name}
  * ${t.description}`;
      }
      return ret;
    }
    await database.update(database.agent, { mcp: content }, { where: { id: agentConfig.id } } as any);
    UserService.allUsers.delete(this.userId);
    return "配置成功";
}
  async OnSystem(content?: string) {
    const agentConfig = await this.agentService.getAgentConfig();
    if (Util.isNullOrEmpty(content)) {
      return `当前配置:
\`\`\`
${agentConfig.system}
\`\`\`
`;
    }
    await database.update(database.agent, { system: content }, { where: { id: agentConfig.id } } as any);
    UserService.allUsers.delete(this.userId);
    return "配置成功";
  }
  async OnInfo(content: string | undefined, chatId: string) {
    return `* 当前时间为: **${Util.NowTimeString}**
* 用户Id: **${this.userId}**
* 会话ID: **${chatId}**`
  }
  async OnClear() {
    await this.agentService.clear()
    UserService.allUsers.delete(this.userId);
    return "清除成功";
  }
  async OnBuildTools() {
    let response = "";
    const result = await axios.post("http://da2.diandian.info:5100/execute", { code: "GetBuildTools" });
    if (result.data?.code === 0) {
      for (const server of result.data.data) {
        response += `* ${server.config?.Name}\n`;
        for (const serverInfo of server.serverInfos) {
          const info = Util.parseJson(serverInfo.serverInfo, {}) as any;
          response += `  * ${String(info.Name ?? "")}地址: http://${serverInfo.serverHost}:${serverInfo.serverPort}\n`;
        }
      }
    }
    return response;
  }

  async onReceiveMessage(chat_type: string, chatId: string, query: string) {
    if (Util.isNullOrEmpty(query)) return;
    if (this.isRunning) {
      await larkService.sendMarkdownMessage(chatId, `${query}\n不能同时执行多个任务,请稍后再试 / Cannot execute multiple tasks simultaneously, please try again later`);
      return;
    }
    this.isRunning = true;
    this.provider = await new LarkChatProvider().init(chatId, query);
    let provider = this.provider!
    try {
      logger.info(`${this.userId} from (${chat_type} - ${chatId}) 收到消息: ${query}`);
      let key = query;
      let value: string | undefined;
      let index = query.indexOf(" ");
      if (index > 0) {
        key = query.substring(0, index).trim();
        value = query.substring(index + 1).trim();
      } else {
        index = query.indexOf("\n");
        if (index > 0) {
          key = query.substring(0, index).trim();
          value = query.substring(index + 1).trim();
        }
      }

      if (this.messages.has(key)) {
        let result = await this.messages.get(key)!(value, chatId);
        if (typeof result === "string") {
          await provider.setMessage(result)
        } else if (typeof result === "object") {
          provider.header = result.header
          provider.elements = result.elements
          await this.provider.updateCardMessage()
        }
        return;
      }
      await this.agentService.stream(chat_type === "p2p" ? "" : chatId, query)
    } catch (e: any) {
      let errorMsg = `${query}\n生成回复时出错 : ${e.message}\n${e.stack}`
      logger.error(errorMsg);
      await provider.setMessage(errorMsg)
    } finally {
      this.isRunning = false;
    }
  }
  async onMessage(message: LangChainMessageChunk): Promise<void> {
    parseChunk2Message(this.provider!, message);
    this.provider!.resetStreamMessage()
    await this.provider!.updateMessage()
  }
  async onStreamMessage(message: string): Promise<void> {
    await this.provider?.setStreamMessage(message)
  }
  async executeTool(toolCall: {type?: "tool_call", id?: string, name: string, args: Record<string, any>}): Promise<boolean> {
    this.toolCallId = toolCall.id
    this.toolCallStatus = "wait";
    try {
      let agentConfig = await this.agentService.getAgentConfig();
      let timeout = parseInt(JSON.parse(agentConfig.config ?? "")?.toolTimeout ?? "30") * 1000
      let end = Util.NowDate + timeout
      let lastSend = 0
      while (this.toolCallStatus == "wait") {
        if (Util.NowDate - lastSend > 300) {
          lastSend = Util.NowDate;
          await this.provider?.insertElement(undefined, {
                "tag": "button",
                "text": {
                  "tag": "plain_text",
                  "content": `允许调用:${toolCall.name}`
                },
                "type": "primary_filled",
                "width": "fill",
                "size": "medium",
                "behaviors": [
                  {
                    "type": "callback",
                    "value": {
                      code: "ToolCall",
                      data: {
                        id: this.toolCallId,
                        ok: true
                      }
                    }
                  }
                ],
                "margin": "0px 0px 0px 0px",
                "element_id": "toolCallOK"
              },
              {
                "tag": "button",
                "text": {
                  "tag": "plain_text",
                  "content": `拒绝调用:${toolCall.name}(${Math.floor((end - Util.NowDate) / 1000)}秒)`
                },
                "type": "danger_filled",
                "width": "fill",
                "size": "medium",
                "behaviors": [
                  {
                    "type": "callback",
                    "value": {
                      code: "ToolCall",
                      data: {
                        id: this.toolCallId,
                        ok: false
                      }
                    }
                  }
                ],
                "margin": "0px 0px 0px 0px",
                "element_id": "toolCallCancel"
              })
        }
        await Util.sleep(10)
        if (Util.NowDate > end) {
          this.toolCallStatus = "cancel"
          break
        }
      }
      await this.provider?.deleteElement("toolCallOK", "toolCallCancel")
      // @ts-ignore
      return this.toolCallStatus == `ok`
    } finally {
      this.toolCallId = undefined
      this.toolCallStatus = "none"
    }
  }

  async onTriggerAction(chatId:string, code:string, data: any, form_value: any) {
    try {
      logger.info(`${this.userId} 收到Action ${code}`, data, form_value);
      if (this.actions.has(code)) {
        let result = await this.actions.get(code)!(data, form_value);
        let elements = undefined
        if (typeof result == "string") {
          elements = [{
            tag: "markdown",
            content: result,
            text_align: "left",
            text_size: "normal",
            margin: "0px 0px 0px 0px",
          }]
        } else if (Array.isArray(result)) {
          elements = result
        }
        if (elements != undefined) {
          return {
            card: {
              type: "raw",
              data: {
                schema: "2.0",
                config: {
                  update_multi: true,
                  streaming_mode: false,
                },
                body: {
                  direction: "vertical",
                  padding: "12px 12px 12px 12px",
                  elements: elements,
                }
              }
            }
          }
        }
      } else {
        return {
          toast: {
            type: "error",
            content: `没有找到对应操作:${code}`,
          },
        }
      }
    } catch (e:any) {
      return {
        toast: {
          type: "error",
          content: `操作失败:${e.message}`,
        },
      }
    }
  }
  async OnSetAgent(data:any, form_value:any) {
    let name = form_value.agent
    if (!Util.isNullOrEmpty(form_value.newAgent)) {
      name = form_value.newAgent
    }
    await database.upsert(
        database.agent,
        { userid: this.userId, name: name, activeTime: Util.NowDate },
        { where: { userid: this.userId, name: name } },
    );
    UserService.allUsers.delete(this.userId);
    return `切换Agent[${name}]成功`
  }
  async OnSetConfig(data:any, form_value:any) {
    let config = JSON.stringify(form_value)
    await database.update(database.agent, { config }, { where: { id: data.id } });
    UserService.allUsers.delete(this.userId);
    return `${config}\n保存成功`
  }
  async OnToolCall(data:any) {
    if (this.toolCallId != data.id) return
    if (this.toolCallStatus != "wait") return
    this.toolCallStatus = data.ok ? "ok" : "cancel"
  }

}
