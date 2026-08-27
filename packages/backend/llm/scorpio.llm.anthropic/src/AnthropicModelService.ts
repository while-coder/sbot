import Anthropic from "@anthropic-ai/sdk";
import type {
  Base64ImageSource,
  ImageBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  RawMessageStreamEvent,
  TextBlockParam,
  ThinkingConfigParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import {
  type AgentTool,
  type ChatMessage,
  type ChatToolCall,
  type ContentPart,
  type ModelInvokeOptions,
  type StructuredInvokeOptions,
  type TokenUsage,
  ContentPartType,
  MessageRole,
  ModelServiceBase,
  StructuredOutputMethod,
  toJsonSchema,
  withJsonModeInstruction,
} from "scorpio.llm";

const ANTHROPIC_CONTENT_KEY = "anthropic_content";
const EMPTY_TOOL_OUTPUT = "(empty tool output)";
const STRUCTURED_OUTPUT_TOOL = "structuredOutput";
const DEFAULT_MAX_TOKENS = 8192;

/** 流式 content block 累加器。 */
interface BlockAccumulator {
  type: "text" | "thinking" | "tool_use";
  text?: string;
  signature?: string;
  id?: string;
  name?: string;
  json?: string;
}

/**
 * Anthropic Messages API 原生实现。
 *
 * 模型返回的完整 content blocks 会存入 additional_kwargs（anthropic_content），
 * 含 thinking 签名的助手消息在后续轮次原样回放，避免签名丢失导致 400。
 */
export class AnthropicModelService extends ModelServiceBase {
  private client?: Anthropic;
  private tools: Tool[] = [];

  private get providerConfig(): Record<string, any> {
    return this.config.config ?? {};
  }

  private get promptCaching(): boolean {
    return !!this.providerConfig.promptCaching;
  }

  private get thinking(): ThinkingConfigParam | undefined {
    const type = this.providerConfig.thinkingType;
    if (!type || !this.supportsReasoning) return undefined;
    if (type === "enabled" && this.providerConfig.thinkingBudget != null) {
      return { type: "enabled", budget_tokens: this.providerConfig.thinkingBudget };
    }
    return { type } as ThinkingConfigParam;
  }

  private isThinkingEnabled(): boolean {
    const type = this.thinking?.type;
    return type === "enabled" || type === "adaptive";
  }

  /**
   * 目录已明确标记不支持推理时，不向 Anthropic 兼容端发送 thinking 参数；
   * 目录未收录时保留用户的 Provider 设置，避免把自定义模型误判为不支持。
   */
  private get supportsReasoning(): boolean {
    if (this.config.llmInfo?.reasoning !== undefined) return this.config.llmInfo.reasoning;
    const info = this.getLLMInfo();
    return !info.fromCatalog || info.reasoning;
  }

  initialize(): void {
    if (!this.config.apiKey) throw new Error("Anthropic config missing apiKey");
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL || undefined,
    });
    this.getLLMInfo();
  }

  override async dispose(): Promise<void> {
    this.client = undefined;
    this.tools = [];
    await super.dispose();
  }

  bindTools(tools: AgentTool[]): void {
    this.assertInitialized();
    const formatted: Tool[] = tools.map(tool => ({
      name: tool.name,
      description: tool.description || undefined,
      input_schema: toJsonSchema(tool.schema) as Tool.InputSchema,
    }));
    if (this.promptCaching && formatted.length > 0) {
      formatted[formatted.length - 1].cache_control = { type: "ephemeral" };
    }
    this.tools = formatted;
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    this.assertInitialized();
    const response = await this.client!.messages.create(this.createParams(prompt), this.requestOptions(options));
    return this.toChatMessage(response);
  }

  async stream(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    this.assertInitialized();
    const stream = await this.client!.messages.create(
      { ...this.createParams(prompt), stream: true },
      this.requestOptions(options),
    );
    return this.accumulateStream(stream);
  }

  async invokeStructured<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    // 思考开启时强制 tool_choice 会被拒，默认走 JSON mode 指令注入
    const method = this.isThinkingEnabled() ? StructuredOutputMethod.JsonMode : StructuredOutputMethod.FunctionCalling;
    try {
      return await this.invokeStructuredWithMethod<T>(schema, prompt, method, options);
    } catch (error) {
      const fallback = method === StructuredOutputMethod.FunctionCalling
        ? StructuredOutputMethod.JsonMode
        : StructuredOutputMethod.FunctionCalling;
      if (!this.shouldFallbackStructured(options, error)) throw error;
      return this.invokeStructuredWithMethod<T>(schema, prompt, fallback, options);
    }
  }

  private invokeStructuredWithMethod<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    method: StructuredOutputMethod,
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    return method === StructuredOutputMethod.FunctionCalling
      ? this.invokeFunctionCalling<T>(schema, prompt, options)
      : this.invokeJsonMode<T>(schema, prompt, options);
  }

  private async invokeFunctionCalling<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const isAnthropicTool = typeof schema?.name === "string"
      && typeof schema?.description === "string"
      && typeof schema?.input_schema === "object"
      && schema.input_schema != null;
    const jsonSchema = isAnthropicTool ? undefined : toJsonSchema(schema);
    const functionName = isAnthropicTool ? schema.name : STRUCTURED_OUTPUT_TOOL;
    const tool: Tool = isAnthropicTool
      ? { ...schema, ...(options?.strict !== undefined && { strict: options.strict }) }
      : {
          name: functionName,
          description: (jsonSchema as { description?: string })?.description
            ?? "Return a JSON object matching the provided schema.",
          input_schema: jsonSchema as Tool.InputSchema,
          ...(options?.strict !== undefined && { strict: options.strict }),
        };
    const response = await this.client!.messages.create({
      ...this.createParams(prompt, false),
      tools: [tool],
      ...(!this.isThinkingEnabled() && { tool_choice: { type: "tool", name: functionName } }),
    }, this.requestOptions(options));
    const toolUse = response.content.find((block): block is ToolUseBlock => block.type === "tool_use");
    if (!toolUse) throw new Error("Anthropic structured output returned no tool call");
    return (toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}) as T;
  }

  private async invokeJsonMode<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const response = await this.client!.messages.create(
      this.createParams(withJsonModeInstruction(prompt, toJsonSchema(schema)), false),
      this.requestOptions(options),
    );
    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map(block => block.text)
      .join("");
    return this.parseStructuredOutput<T>(text);
  }

  private createParams(prompt: string | ChatMessage[], includeTools = true): MessageCreateParamsNonStreaming {
    const info = this.getLLMInfo();
    const maxTokens = this.config.maxTokens
      ?? (info.fromCatalog ? info.maxOutputTokens : undefined)
      ?? DEFAULT_MAX_TOKENS;
    const { system, messages } = this.toRequestMessages(prompt);
    const thinking = this.thinking;
    return {
      model: this.config.model,
      max_tokens: maxTokens,
      messages,
      ...(system !== undefined && { system }),
      ...(includeTools && this.tools.length > 0 && { tools: this.tools }),
      ...(thinking && { thinking }),
      // 思考开启时发送 temperature 会被拒
      ...(info.temperature !== false && !thinking && this.config.temperature != null && { temperature: this.config.temperature }),
    };
  }

  private toRequestMessages(prompt: string | ChatMessage[]): {
    system?: string | TextBlockParam[];
    messages: MessageParam[];
  } {
    if (typeof prompt === "string") return { messages: [{ role: "user", content: prompt }] };

    const systemText: string[] = [];
    const messages: MessageParam[] = [];
    let toolResults: ToolResultBlockParam[] = [];

    // tool_result 必须集中在 tool_use 之后的同一条 user 消息里，连续 Tool 消息先攒后冲
    const flushToolResults = (): void => {
      if (toolResults.length === 0) return;
      messages.push({ role: "user", content: toolResults });
      toolResults = [];
    };

    for (const message of prompt) {
      if (message.role === MessageRole.System) {
        const text = this.contentToText(message.content);
        if (text.trim()) systemText.push(text);
      } else if (message.role === MessageRole.Tool) {
        toolResults.push(this.toToolResult(message));
      } else {
        flushToolResults();
        if (message.role === MessageRole.AI) {
          const blocks = this.toAssistantBlocks(message);
          if (blocks.length > 0) messages.push({ role: "assistant", content: blocks as MessageParam["content"] });
        } else {
          const blocks = this.toUserBlocks(message.content);
          if (blocks.length > 0) messages.push({ role: "user", content: blocks as MessageParam["content"] });
        }
      }
    }
    flushToolResults();

    if (systemText.length === 0) return { messages };
    const system = systemText.join("\n\n");
    return { system: this.applySystemCache(system), messages };
  }

  private applySystemCache(system: string): string | TextBlockParam[] {
    if (!this.promptCaching) return system;
    return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  }

  private toToolResult(message: ChatMessage): ToolResultBlockParam {
    if (!message.tool_call_id) throw new Error("Anthropic tool message missing tool_call_id");
    const content = message.content;
    let result: ToolResultBlockParam["content"];
    if (typeof content === "string") {
      result = content.trim() ? content : EMPTY_TOOL_OUTPUT;
    } else if (Array.isArray(content)) {
      const parts = content
        .map(part => this.toResultPart(part))
        .filter((part): part is TextBlockParam | ImageBlockParam => part != null);
      result = parts.length > 0 ? parts : EMPTY_TOOL_OUTPUT;
    } else {
      result = EMPTY_TOOL_OUTPUT;
    }
    return { type: "tool_result", tool_use_id: message.tool_call_id, content: result };
  }

  private toResultPart(part: ContentPart): TextBlockParam | ImageBlockParam | undefined {
    if (part?.type === ContentPartType.Text && typeof part.text === "string" && part.text.trim()) {
      return { type: "text", text: part.text };
    }
    if (part?.type === ContentPartType.Image && typeof part.data === "string") {
      const source = this.toImageSource(part.data, part.mimeType);
      if (source) return { type: "image", source };
    }
    return undefined;
  }

  private toAssistantBlocks(message: ChatMessage): MessageParam["content"] {
    // thinking 块带签名，回放原始块避免签名丢失；无 thinking 时直接由字段重建
    const replay = message.additional_kwargs?.[ANTHROPIC_CONTENT_KEY];
    if (Array.isArray(replay)) {
      const blocks = replay.filter((block): block is Record<string, any> =>
        !!block && typeof block === "object"
        && ["thinking", "redacted_thinking", "text", "tool_use"].includes(block.type)
        // 兼容网关可能返回空 text 块，回放时剔除避免 400
        && (block.type !== "text" || (typeof block.text === "string" && block.text.trim() !== "")));
      if (blocks.some(block => block.type === "thinking" || block.type === "redacted_thinking")) {
        return blocks as unknown as MessageParam["content"];
      }
    }

    const blocks: Array<TextBlockParam | { type: "tool_use"; id: string; name: string; input: unknown }> = [];
    const text = this.contentToText(message.content);
    if (text.trim()) blocks.push({ type: "text", text });
    for (const call of message.tool_calls ?? []) {
      if (!call.id) throw new Error(`Anthropic tool call '${call.name}' missing id`);
      blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.args ?? {} });
    }
    return blocks;
  }

  private toUserBlocks(content: ChatMessage["content"]): MessageParam["content"] {
    if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : [];
    if (!Array.isArray(content)) return [];

    const blocks: MessageParam["content"] = [];
    for (const part of content) {
      if (part?.type === ContentPartType.Text && typeof part.text === "string" && part.text.trim()) {
        blocks.push({ type: "text", text: part.text });
      } else if (part?.type === ContentPartType.Image && typeof part.data === "string") {
        const source = this.toImageSource(part.data, part.mimeType);
        if (source) blocks.push({ type: "image", source });
      } else if (part?.type === ContentPartType.ImageUrl && typeof part.image_url?.url === "string") {
        blocks.push({ type: "image", source: { type: "url", url: part.image_url.url } });
      }
    }
    return blocks;
  }

  private toImageSource(data: string, mimeType?: string): ImageBlockParam["source"] | undefined {
    if (data.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(data);
      if (!match) return undefined;
      return { type: "base64", media_type: match[1] as Base64ImageSource["media_type"], data: match[2] };
    }
    if (!mimeType) return undefined;
    return { type: "base64", media_type: mimeType as Base64ImageSource["media_type"], data };
  }

  private contentToText(content: ChatMessage["content"]): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter(part => part?.type === ContentPartType.Text && typeof part.text === "string")
      .map(part => (part as { text: string }).text)
      .join("");
  }

  private toChatMessage(response: Message): ChatMessage {
    const text: string[] = [];
    const thinking: string[] = [];
    const toolCalls: ChatToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") text.push(block.text);
      else if (block.type === "thinking") thinking.push(block.thinking);
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input && typeof block.input === "object" ? block.input as Record<string, any> : {},
          type: "tool_call",
        });
      }
    }
    return {
      role: MessageRole.AI,
      content: text.join(""),
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      id: response.id,
      additional_kwargs: {
        ...this.contentKwargs(response.content),
        ...(response.stop_reason && { stop_reason: response.stop_reason }),
        ...(thinking.length > 0 && { reasoning_content: thinking.join("") }),
      },
      ...(response.usage && { usage: this.toUsage(response.usage) }),
    };
  }

  /** 仅当含非 text 块（thinking / tool_use）时携带原始块供回放，空 text 块剔除。 */
  private contentKwargs(blocks: Message["content"]): Record<string, any> {
    const kept = blocks.filter(block => block.type !== "text" || (block.text ?? "").trim() !== "");
    return kept.some(block => block.type !== "text") ? { [ANTHROPIC_CONTENT_KEY]: kept } : {};
  }

  private async *accumulateStream(stream: AsyncIterable<RawMessageStreamEvent>): AsyncIterable<ChatMessage> {
    let responseId: string | undefined;
    const blocks: Array<BlockAccumulator | undefined> = [];
    let stopReason: string | undefined;
    let usage: TokenUsage | undefined;

    for await (const event of stream) {
      switch (event.type) {
        case "message_start":
          responseId = event.message.id;
          if (event.message.usage) {
            const u = event.message.usage;
            usage = {
              input_tokens: u.input_tokens ?? 0,
              output_tokens: u.output_tokens ?? 0,
              total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
              ...(u.cache_creation_input_tokens != null && { cache_creation_input_tokens: u.cache_creation_input_tokens }),
              ...(u.cache_read_input_tokens != null && { cache_read_input_tokens: u.cache_read_input_tokens }),
            };
          }
          break;
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "text") blocks[event.index] = { type: "text", text: "" };
          else if (block.type === "thinking") blocks[event.index] = { type: "thinking", text: "", signature: "" };
          else if (block.type === "tool_use") blocks[event.index] = { type: "tool_use", id: block.id, name: block.name, json: "" };
          break;
        }
        case "content_block_delta": {
          const acc = blocks[event.index];
          if (!acc) break;
          if (event.delta.type === "text_delta") acc.text = (acc.text ?? "") + event.delta.text;
          else if (event.delta.type === "thinking_delta") acc.text = (acc.text ?? "") + event.delta.thinking;
          else if (event.delta.type === "signature_delta") acc.signature = (acc.signature ?? "") + event.delta.signature;
          else if (event.delta.type === "input_json_delta" && acc.type === "tool_use") acc.json = (acc.json ?? "") + event.delta.partial_json;
          break;
        }
        case "message_delta":
          if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
          if (event.usage?.output_tokens != null && usage) {
            usage.output_tokens = event.usage.output_tokens;
            usage.total_tokens = usage.input_tokens + event.usage.output_tokens;
          }
          break;
      }
      if (event.type === "content_block_delta") yield this.toStreamingMessage(blocks, responseId, stopReason, usage);
    }
    // 末尾兜底一次（无 delta 的事件流 / 中断场景），保证 usage 与 stop_reason 不丢
    yield this.toStreamingMessage(blocks, responseId, stopReason, usage);
  }

  private toStreamingMessage(
    blocks: Array<BlockAccumulator | undefined>,
    responseId: string | undefined,
    stopReason: string | undefined,
    usage: TokenUsage | undefined,
  ): ChatMessage {
    const accs = blocks.filter((acc): acc is BlockAccumulator => acc != null);
    const text = accs.filter(acc => acc.type === "text").map(acc => acc.text ?? "").join("");
    const thinking = accs.filter(acc => acc.type === "thinking").map(acc => acc.text ?? "").join("");
    const toolCalls: ChatToolCall[] = accs
      .filter(acc => acc.type === "tool_use")
      .map(acc => ({
        id: acc.id,
        name: acc.name ?? "",
        args: this.tryParseToolArguments(acc.json ?? ""),
        type: "tool_call",
      }));
    const contentBlocks = accs
      .filter(acc => acc.type === "thinking" || acc.type === "tool_use")
      .map(acc => acc.type === "thinking"
        ? { type: "thinking", thinking: acc.text ?? "", signature: acc.signature ?? "" }
        : { type: "tool_use", id: acc.id ?? "", name: acc.name ?? "", input: this.tryParseToolArguments(acc.json ?? "") });
    return {
      role: MessageRole.AI,
      content: text,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(responseId && { id: responseId }),
      additional_kwargs: {
        ...(contentBlocks.length > 0 && { [ANTHROPIC_CONTENT_KEY]: contentBlocks }),
        ...(stopReason && { stop_reason: stopReason }),
        ...(thinking && { reasoning_content: thinking }),
      },
      ...(usage && { usage }),
    };
  }

  private toUsage(usage: NonNullable<Message["usage"]>): TokenUsage {
    return {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      ...(usage.cache_creation_input_tokens != null && { cache_creation_input_tokens: usage.cache_creation_input_tokens }),
      ...(usage.cache_read_input_tokens != null && { cache_read_input_tokens: usage.cache_read_input_tokens }),
    };
  }

  private assertInitialized(): void {
    if (!this.client) throw new Error(`${this.constructor.name} is not initialized`);
  }

  private requestOptions(options?: ModelInvokeOptions): { signal: AbortSignal } | undefined {
    return options?.signal ? { signal: options.signal } : undefined;
  }
}
