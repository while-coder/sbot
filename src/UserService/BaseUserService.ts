import {
    OnMessageCallback,
    OnStreamMessageCallback,
    ExecuteToolCallback
} from "../Agent/AgentService";

export interface BaseUserService {
    get userId(): string;

    onMessage: OnMessageCallback;

    onStreamMessage: OnStreamMessageCallback;

    executeTool: ExecuteToolCallback;
}
