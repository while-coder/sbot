import { type ChatMessage, type IModelService, type ModelInvokeOptions, type StructuredInvokeOptions } from "scorpio.llm";
import { withRetry } from "../Utils/withRetry";
import { runtimeActivity } from "../Core/RuntimeActivity";

export class RetryModelServiceProxy implements IModelService {
    constructor(private inner: IModelService, private maxRetries = 2) {}

    get config() { return this.inner.config; }

    supportsVision(): Promise<boolean> { return this.inner.supportsVision(); }

    async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
        return runtimeActivity.track(
            withRetry(() => this.inner.invoke(prompt, options), options?.signal, this.maxRetries),
        );
    }

    bindTools(tools: any[]): void { this.inner.bindTools(tools); }

    async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T> {
        return runtimeActivity.track(
            withRetry(() => this.inner.invokeStructured<T>(schema, prompt, options), options?.signal, this.maxRetries),
        );
    }

    async stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
        return runtimeActivity.trackStream(
            withRetry(() => this.inner.stream(messages, options), options?.signal, this.maxRetries),
        );
    }

    async dispose(): Promise<void> { return this.inner.dispose(); }
}
