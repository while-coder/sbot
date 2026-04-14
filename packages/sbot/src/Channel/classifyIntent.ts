import { z } from "zod";
import { MessageRole, type MessageContent } from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";

const logger = LoggerService.getLogger("classifyIntent.ts");

const IntentSchema = z.object({
  shouldReply: z.boolean().describe("Whether the AI assistant should reply to this message"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
  reasoning: z.string().describe("Brief justification"),
});

type IntentResult = z.infer<typeof IntentSchema>;

const DEFAULT_INTENT_PROMPT = `你是一个消息意图分类器。判断以下群聊消息是否需要 AI 助手回复。

需要回复的消息：提问、请求帮助、寻求建议、技术咨询、明确 @机器人 的消息。
不需要回复的消息：闲聊、日常问候、表情包、群通知、成员间的普通对话。

只根据消息内容判断，不要过度解读。`;

/**
 * 使用轻量模型判断群聊消息是否需要 AI 回复。
 * 返回 true = 需要回复，false = 静默跳过。
 * 任何异常都降级放行（返回 true）。
 */
export async function classifyIntent(
  query: MessageContent,
  intentModelId: string,
  intentPrompt: string | null,
  intentThreshold: number,
): Promise<boolean> {
  const modelService = await config.getModelService(intentModelId);
  if (!modelService) return true;

  try {
    const text = typeof query === 'string'
      ? query
      : query.filter(b => b.type === 'text').map(b => b.text).join('\n');

    if (!text.trim()) return true;

    const result = await modelService.invokeStructured<IntentResult>(IntentSchema, [
      { role: MessageRole.System, content: intentPrompt || DEFAULT_INTENT_PROMPT },
      { role: MessageRole.Human, content: text },
    ]);

    const shouldReply = result.shouldReply && result.confidence >= intentThreshold;
    if (!shouldReply) {
      logger.info(`意图过滤: "${text.length > 80 ? text.slice(0, 80) + '...' : text}" → 已过滤 (confidence=${result.confidence}, threshold=${intentThreshold}, reasoning=${result.reasoning})`);
    }
    return shouldReply;
  } catch {
    return true;
  } finally {
    await modelService.dispose();
  }
}
