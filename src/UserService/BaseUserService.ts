import {LangChainMessageChunk} from "../Agent/AgentService";

export interface BaseUserService {
    get userId(): string;
    
    onMessage(message: LangChainMessageChunk): Promise<void>;
    
    onStreamMessage(message: string): Promise<void>;
    
    executeTool(toolCall: {type?: "tool_call", id?: string, name: string, args: Record<string, any>}): Promise<boolean>;
}
