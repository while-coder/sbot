import "reflect-metadata";
import { AgentMessage, AgentToolCall, ToolApproval } from "scorpio.ai";
import { AgentRunner } from "../Agent/AgentRunner";
import { config } from '../Core/Config';
import { ContextType } from '../Core/Database';
import { buildExecuteTool } from './buildExecuteTool';
import { dirThreadId, sessionThreadId } from 'sbot.commons';

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

    async executeAgentTool(toolCall: AgentToolCall): Promise<ToolApproval> {
        this.emit({ type: 'tool_call', id: toolCall.id, name: toolCall.name, args: toolCall.args });
        return ToolApproval.Allow;
    }


    async processAIMessage(query: string, args: any): Promise<void> {
        const workPath = args?.workPath as string | undefined;
        if (workPath) {
            // 目录模式：从 workPath/.sbot/settings.json 读取 agent/saver/memory
            const localCfg = config.getDirectoryConfig(workPath);
            if (!localCfg) throw new Error(`目录 "${workPath}" 未配置 agent`);
            const threadId = dirThreadId(workPath);
            const extraInfo = `<scheduler-id>${workPath}</scheduler-id>`;
            await AgentRunner.run(query, {
                onMessage: this.onAgentMessage.bind(this),
                onStreamMessage: this.onAgentStreamMessage.bind(this),
                executeTool: buildExecuteTool(threadId, this.executeAgentTool.bind(this)),
            }, localCfg.agent, localCfg.saver, threadId, ContextType.Directory, extraInfo, localCfg.memory, workPath);
        } else {
            // 会话模式：通过 sessionId 查找全局会话配置
            const sessionId = args?.sessionId as string;
            const session = sessionId ? config.getSession(sessionId) : undefined;
            if (!session) throw new Error(`会话 "${sessionId}" 不存在`);
            const threadId = sessionThreadId(sessionId);
            const extraInfo = `<scheduler-id>${sessionId}</scheduler-id>`;
            await AgentRunner.run(query, {
                onMessage: this.onAgentMessage.bind(this),
                onStreamMessage: this.onAgentStreamMessage.bind(this),
                executeTool: buildExecuteTool(threadId, this.executeAgentTool.bind(this)),
            }, session.agent, session.saver, threadId, ContextType.Session, extraInfo, session.memory);
        }
    }
}
