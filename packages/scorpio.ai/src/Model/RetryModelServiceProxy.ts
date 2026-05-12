import { IModelService } from "./IModelService";
import { withRetry } from "../Utils/withRetry";
import { type ChatMessage } from "../Saver/IAgentSaverService";

export class RetryModelServiceProxy implements IModelService {
    constructor(private inner: IModelService, private maxRetries = 2) {}

    get contextWindow() { return this.inner.contextWindow; }

    async invoke(prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<ChatMessage> {
        return withRetry(() => this.inner.invoke(prompt, options), options?.signal, this.maxRetries);
    }

    bindTools(tools: any[]): void { this.inner.bindTools(tools); }

    async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<T> {
        return withRetry(() => this.inner.invokeStructured<T>(schema, prompt, options), options?.signal, this.maxRetries);
    }

    async stream(messages: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<ChatMessage>> {
        return withRetry(() => this.inner.stream(messages, options), options?.signal, this.maxRetries);
    }

    async dispose(): Promise<void> { return this.inner.dispose(); }
}
