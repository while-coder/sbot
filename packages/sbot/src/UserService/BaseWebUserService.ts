import "reflect-metadata";
import { AgentMessage, AgentToolCall, MCPToolResult } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from '../Core/Config';
import { ContextType } from '../Core/Database';

export type WebChatEvent =
    | { type: "stream"; content: string }
    | { type: "message"; role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }
    | { type: "tool_call"; id?: string; name: string; args: Record<string, any> }
    | { type: "done" }
    | { type: "error"; message: string };

export abstract class BaseWebUserService {

    protected abstract emit(event: WebChatEvent): void;

    async onAgentMessage(message: AgentMessage): Promise<void> {
        this.emit({
            type: 'message',
            role: message.type,
            content: message.content,
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
        });
    }

    async onAgentStreamMessage(message: AgentMessage): Promise<void> {
        this.emit({ type: 'stream', content: message.content ?? '' });
    }

    async executeAgentTool(toolCall: AgentToolCall): Promise<boolean> {
        this.emit({ type: 'tool_call', id: toolCall.id, name: toolCall.name, args: toolCall.args });
        return true;
    }


    async processAIMessage(query: string, args: any): Promise<void> {
        const callbacks = {
            onMessage: this.onAgentMessage.bind(this),
            onStreamMessage: this.onAgentStreamMessage.bind(this),
            executeTool: this.executeAgentTool.bind(this),
            convertImages: async (r: MCPToolResult) => r,
        };
        const workPath = args?.workPath as string | undefined;
        if (workPath) {
            // 目录模式：从 workPath/.sbot/settings.json 读取 agent/saver/memory
            const localCfg = config.getDirectoryConfig(workPath);
            if (!localCfg) throw new Error(`目录 "${workPath}" 未配置 agent`);
            const saverThreadId = workPath.replace(/[:/\\]/g, '_');
            const extraInfo = `<scheduler-id>${workPath}</scheduler-id>`;
            await AgentRunner.run(query, callbacks, localCfg.agent, localCfg.saver, `dir_${saverThreadId}`, ContextType.Directory, extraInfo, localCfg.memory, workPath);
        } else {
            // 会话模式：通过 sessionId 查找全局会话配置
            const sessionId = args?.sessionId as string;
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`会话 "${sessionId}" 不存在`);
            const extraInfo = `<scheduler-id>${sessionId}</scheduler-id>`;
            await AgentRunner.run(query, callbacks, session.agent, session.saver, `session_${sessionId}`, ContextType.Session, extraInfo, session.memory);
        }
    }
}
