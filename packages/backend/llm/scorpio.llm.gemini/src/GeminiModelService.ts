import { randomUUID } from "node:crypto";
import type {
  Content,
  FunctionDeclaration,
  GenerateContentConfig,
  GenerateContentParameters,
  GenerateContentResponse,
  Part,
} from "@google/genai";
import {
  type ChatMessage,
  type ChatToolCall,
  type ContentPart,
  type IModelService,
  type ModelInvokeOptions,
  type StructuredInvokeOptions,
  type TokenUsage,
  ContentPartType,
  MessageRole,
  toJsonSchema,
  withJsonModeInstruction,
} from "scorpio.llm";
import { GeminiServiceBase } from "./GeminiServiceBase";

const EMPTY_TOOL_OUTPUT = "(empty tool output)";
/** thought signature 存放键沿用 LangChain 实现，保证历史会话回放兼容。 */
const THOUGHT_SIGNATURES_KEY = "__gemini_function_call_thought_signatures__";
/** gemini-3 回放 functionCall 缺少签名时的占位签名（与 LangChain 实现一致）。 */
const DUMMY_SIGNATURE =
  "ErYCCrMCAdHtim9kOoOkrPiCNVsmlpMIKd7ZMxgiFbVQOkgp7nlLcDMzVsZwIzvuT7nQROivoXA72ccC2lSDvR0Gh7dkWaGuj7ctv6t7ZceHnecx0QYa+ix8tYpRfjhyWozQ49lWiws6+YGjCt10KRTyWsZ2h6O7iHTYJwKIRwGUHRKy/qK/6kFxJm5ML00gLq4D8s5Z6DBpp2ZlR+uF4G8jJgeWQgyHWVdx2wGYElaceVAc66tZdPQRdOHpWtgYSI1YdaXgVI8KHY3/EfNc2YqqMIulvkDBAnuMhkAjV9xmBa54Tq+ih3Im4+r3DzqhGqYdsSkhS0kZMwte4Hjs65dZzCw9lANxIqYi1DJ639WNPYihp/DCJCos7o+/EeSPJaio5sgWDyUnMGkY1atsJZ+m7pj7DD5tvQ==";

/**
 * Gemini generateContent 原生实现。
 *
 * 与 ChatMessage 之间只做应用边界转换：AI 输出的 thinking / inlineData /
 * functionCall 保持 LangChain 时代的 part 形状，下游渲染与多轮回放不受影响。
 */
export class GeminiModelService extends GeminiServiceBase implements IModelService {
  private tools: FunctionDeclaration[] = [];

  override async dispose(): Promise<void> {
    await super.dispose();
    this.tools = [];
  }

  bindTools(tools: any[]): void {
    this.assertInitialized();
    this.tools = tools.map(tool => ({
      name: tool.name,
      description: tool.description || undefined,
      // Schema 不接受 $schema/additionalProperties/strict，先递归剥离
      parameters: this.toGeminiSchema(toJsonSchema(tool.schema)),
    }));
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    this.assertInitialized();
    const response = await this.client!.models.generateContent(this.createParams(prompt, options));
    return this.toChatMessage(response);
  }

  async stream(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    this.assertInitialized();
    const stream = await this.client!.models.generateContentStream(this.createParams(prompt, options));
    return this.accumulateStream(stream);
  }

  async invokeStructured<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    this.assertInitialized();
    const jsonSchema = this.toGeminiSchema(toJsonSchema(schema));
    const baseParams = this.createParams(prompt, options);
    try {
      const response = await this.client!.models.generateContent({
        ...baseParams,
        config: { ...baseParams.config, responseMimeType: "application/json", responseSchema: jsonSchema },
      });
      return this.parseStructuredOutput<T>(this.responseText(response));
    } catch (error) {
      if (!this.shouldFallbackStructured(options, error)) throw error;
      // 退化为纯 JSON mode：指令注入 schema，靠提示词约束输出
      const fallbackParams = this.createParams(withJsonModeInstruction(prompt, jsonSchema), options);
      const response = await this.client!.models.generateContent({
        ...fallbackParams,
        config: { ...fallbackParams.config, responseMimeType: "application/json" },
      });
      return this.parseStructuredOutput<T>(this.responseText(response));
    }
  }

  /**
   * 参数级默认值（temperature / maxTokens）由 models.dev 目录补全：
   * temperature=false 的模型发送该参数会被拒；maxTokens 未配置时取目录
   * maxOutputTokens，避免默认值偏小易截断。
   */
  private createParams(
    prompt: string | ChatMessage[],
    options?: ModelInvokeOptions,
    extraConfig?: GenerateContentConfig,
  ): GenerateContentParameters {
    const info = this.getLLMInfo();
    const maxOutputTokens = this.config.maxTokens ?? (info.fromCatalog ? info.maxOutputTokens : undefined);
    const { contents, systemInstruction } = this.toContents(prompt);
    return {
      model: this.config.model,
      contents,
      config: {
        ...(systemInstruction && { systemInstruction }),
        ...(info.temperature !== false && this.config.temperature != null && { temperature: this.config.temperature }),
        ...(maxOutputTokens != null && { maxOutputTokens }),
        ...(this.tools.length > 0 && { tools: [{ functionDeclarations: this.tools }] }),
        ...this.requestOptions(options),
        ...extraConfig,
      },
    };
  }

  // ---- 请求侧：ChatMessage → Gemini Content ----

  /**
   * system 消息抽到 systemInstruction；Tool 消息转 functionResponse
   * （Gemini 按函数名而非 id 配对，函数名按 tool_call_id 回溯历史 AI 消息），
   * 连续多条工具结果并入同一 user content（对应并行 functionCall）。
   */
  private toContents(prompt: string | ChatMessage[]): { contents: Content[]; systemInstruction?: Part[] } {
    if (typeof prompt === "string") return { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    const contents: Content[] = [];
    const systemParts: Part[] = [];
    const toolNameById = new Map<string, string>();

    for (let i = 0; i < prompt.length; i++) {
      const message = prompt[i];
      if (message.role === MessageRole.System) {
        systemParts.push(...this.toParts(message));
        continue;
      }

      if (message.role === MessageRole.Tool) {
        const parts: Part[] = [];
        while (i < prompt.length && prompt[i].role === MessageRole.Tool) {
          parts.push(this.toFunctionResponsePart(prompt[i], toolNameById));
          i++;
        }
        i--;
        if (parts.length > 0) contents.push({ role: "user", parts });
        continue;
      }

      const parts = this.toParts(message);
      if (message.role === MessageRole.AI) {
        for (const call of message.tool_calls ?? []) {
          if (call.id) toolNameById.set(call.id, call.name);
          parts.push(this.toFunctionCallPart(call, message));
        }
      }
      // 空内容对 Gemini 直接 400（"Part.text must not be empty"），无 parts 的消息丢弃
      if (parts.length === 0) continue;
      contents.push({ role: message.role === MessageRole.AI ? "model" : "user", parts });
    }
    return { contents, ...(systemParts.length > 0 && { systemInstruction: systemParts }) };
  }

  /** ChatMessage.content → Gemini Part 列表（含 AI 输出 thinking / inlineData part 的回放）。 */
  private toParts(message: ChatMessage): Part[] {
    const content = message.content;
    if (typeof content === "string") return content ? [{ text: content }] : [];
    if (!Array.isArray(content)) return [];

    const parts: Part[] = [];
    for (const part of content) {
      if (part?.type === ContentPartType.Text && typeof part.text === "string" && part.text.trim()) {
        parts.push({ text: part.text });
      } else if (part?.type === ContentPartType.Image && typeof part.data === "string") {
        parts.push({ inlineData: { mimeType: part.mimeType || "image/png", data: part.data } });
      } else if (part?.type === ContentPartType.Audio && typeof part.data === "string") {
        parts.push({ inlineData: { mimeType: part.mimeType || "audio/mpeg", data: part.data } });
      } else if (part?.type === ContentPartType.ImageUrl && typeof part.image_url?.url === "string") {
        parts.push(this.imageUrlPart(part.image_url.url));
      } else if (part?.type === "thinking" && typeof (part as any).thinking === "string") {
        const signature = (part as any).signature;
        parts.push({ text: (part as any).thinking, thought: true, ...(signature && { thoughtSignature: signature }) });
      } else if (part?.type === "inlineData" && (part as any).inlineData) {
        parts.push({ inlineData: (part as any).inlineData });
      }
    }
    return parts;
  }

  private imageUrlPart(url: string): Part {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url } };
  }

  private toFunctionCallPart(call: ChatToolCall, message: ChatMessage): Part {
    const signatures = message.additional_kwargs?.[THOUGHT_SIGNATURES_KEY];
    const signature = (call.id && signatures?.[call.id]) || this.dummySignature;
    return {
      functionCall: { name: call.name, args: call.args ?? {} },
      ...(signature && { thoughtSignature: signature }),
    };
  }

  private toFunctionResponsePart(message: ChatMessage, toolNameById: Map<string, string>): Part {
    const name = message.name ?? (message.tool_call_id ? toolNameById.get(message.tool_call_id) : undefined);
    if (!name) throw new Error(`Gemini requires a function name for tool response '${message.tool_call_id ?? ""}'`);
    const result = this.toolResultContent(message);
    return {
      functionResponse: {
        name,
        ...(message.tool_call_id && { id: message.tool_call_id }),
        response: message.status === "error" ? { error: { details: result } } : { result },
      },
    };
  }

  private toolResultContent(message: ChatMessage): string | Part[] {
    if (typeof message.content === "string") return message.content || EMPTY_TOOL_OUTPUT;
    const parts = this.toParts(message);
    return parts.length > 0 ? parts : EMPTY_TOOL_OUTPUT;
  }

  /** gemini-3 的 functionCall 回放要求携带 thoughtSignature，缺失时用占位签名。 */
  private get dummySignature(): string | undefined {
    return this.config.model.includes("gemini-3") ? DUMMY_SIGNATURE : undefined;
  }

  // ---- 响应侧：Gemini Response → ChatMessage ----

  private toChatMessage(response: GenerateContentResponse): ChatMessage {
    const candidate = response.candidates?.[0];
    if (!candidate && response.promptFeedback?.blockReason) {
      throw new Error(`Gemini prompt blocked: ${response.promptFeedback.blockReason}`);
    }
    return this.toMessage(candidate?.content?.parts ?? [], {
      id: response.responseId,
      finishReason: candidate?.finishReason,
      usage: response.usageMetadata ? this.toUsage(response.usageMetadata) : undefined,
    });
  }

  private async *accumulateStream(stream: AsyncGenerator<GenerateContentResponse>): AsyncIterable<ChatMessage> {
    const parts: Part[] = [];
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;
    let responseId: string | undefined;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) usage = this.toUsage(chunk.usageMetadata);
      if (chunk.responseId) responseId = chunk.responseId;
      const candidate = chunk.candidates?.[0];
      if (candidate) {
        parts.push(...(candidate.content?.parts ?? []));
        if (candidate.finishReason) finishReason = candidate.finishReason;
      }
      if (parts.length === 0 && !usage) continue;
      yield this.toMessage(parts, { id: responseId, finishReason, usage });
    }
  }

  private toMessage(
    parts: Part[],
    meta: { id?: string; finishReason?: string; usage?: TokenUsage },
  ): ChatMessage {
    const { toolCalls, signatures } = this.toToolCalls(parts);
    return {
      role: MessageRole.AI,
      content: this.toMessageContent(parts),
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(meta.id && { id: meta.id }),
      additional_kwargs: {
        ...(Object.keys(signatures).length > 0 && { [THOUGHT_SIGNATURES_KEY]: signatures }),
        // 小写化后 MAX_TOKENS → max_tokens，命中下游的最大 Token 截断判断
        ...(meta.finishReason && { finish_reason: meta.finishReason.toLowerCase() }),
      },
      ...(meta.usage && { usage: meta.usage }),
    };
  }

  private toToolCalls(parts: Part[]): { toolCalls: ChatToolCall[]; signatures: Record<string, string> } {
    const toolCalls: ChatToolCall[] = [];
    const signatures: Record<string, string> = {};
    for (const part of parts) {
      const call = part.functionCall;
      if (!call) continue;
      const id = call.id ?? randomUUID();
      toolCalls.push({ id, name: call.name ?? "", args: this.tryParseToolArguments(call.args), type: "tool_call" });
      if (part.thoughtSignature) signatures[id] = part.thoughtSignature;
    }
    return { toolCalls, signatures };
  }

  private toMessageContent(parts: Part[]): ChatMessage["content"] {
    if (parts.length === 0) return "";
    // 纯文本响应归一为 string（LangChain 时代的约定，下游按 string 优化过）
    if (parts.every(part => typeof part.text === "string" && !part.thought)) {
      return parts.map(part => part.text).join("");
    }
    const content: ContentPart[] = [];
    for (const part of parts) {
      if (part.functionCall) continue; // 已单列为 tool_calls
      if (part.thought && typeof part.text === "string") {
        content.push({ type: "thinking", thinking: part.text, ...(part.thoughtSignature && { signature: part.thoughtSignature }) });
      } else if (typeof part.text === "string") {
        content.push({ type: "text", text: part.text });
      } else if (part.inlineData) {
        content.push({ type: "inlineData", inlineData: part.inlineData });
      }
    }
    return content;
  }

  private responseText(response: GenerateContentResponse): string {
    return (response.candidates?.[0]?.content?.parts ?? [])
      .filter(part => typeof part.text === "string" && !part.thought)
      .map(part => part.text)
      .join("");
  }

  /** 递归剥离 Gemini Schema 不支持的键（$schema / additionalProperties / strict）。 */
  private toGeminiSchema(schema: any): any {
    if (Array.isArray(schema)) return schema.map(item => this.toGeminiSchema(item));
    if (!schema || typeof schema !== "object") return schema;
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "$schema" || key === "additionalProperties" || key === "strict") continue;
      result[key] = this.toGeminiSchema(value);
    }
    return result;
  }
}
