import { z } from "zod";
import { MessageRole, truncate, contentToString, type MessageContent } from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";
import { getSessionName } from "../utils";

const logger = LoggerService.getLogger("classifyIntent.ts");

const INTENT_JSON_FORMAT_INSTRUCTION = [
  "Return JSON only. Do not include markdown, code fences, or any extra text.",
  "The JSON object must match this shape:",
  '{"shouldReply": false, "confidence": 0.0, "reasoning": "brief justification"}',
].join("\n");

const IntentSchema = z.object({
  shouldReply: z.boolean().describe("Whether the AI assistant should reply to this message"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
  reasoning: z.string().describe("Brief justification"),
});

type IntentResult = z.infer<typeof IntentSchema>;

/**
 * Classify whether a group chat message needs an AI reply.
 * Returns true = should reply, false = skip silently.
 * Falls back to false (skip) on any error.
 */
export async function classifyIntent(
  query: MessageContent,
  intentModelId: string,
  intentPrompt: string | null,
  intentThreshold: number,
  sessionId?: number | string,
): Promise<boolean> {
  const modelService = config.getModelService(intentModelId);
  if (!modelService) return true;
  let text = truncate(contentToString(query), 100);
  const modelInfo = `intentModelId=${intentModelId}`;
  const sessionName = await getSessionName(sessionId);
  try {
    const systemPrompt = [
      intentPrompt || loadPrompt('intent/default.txt'),
      INTENT_JSON_FORMAT_INSTRUCTION,
    ].join("\n\n");
    const result = await modelService.invokeStructured<IntentResult>(IntentSchema, [
      { role: MessageRole.System, content: systemPrompt },
      { role: MessageRole.Human, content: query },
    ], {
      signal: AbortSignal.timeout(120_000),
    });
    const shouldReply = result.shouldReply && result.confidence >= intentThreshold;
    if (shouldReply) {
      logger.info(`[${sessionName ?? '?'}] ✅ 意图通过: "${text}" (${modelInfo}, 置信度=${result.confidence}, 阈值=${intentThreshold}, 原因=${result.reasoning})`);
    } else {
      logger.info(`[${sessionName ?? '?'}] 🚫 意图过滤: "${text}" (${modelInfo}, 置信度=${result.confidence}, 阈值=${intentThreshold}, 原因=${result.reasoning})`);
    }
    return shouldReply;
  } catch (err) {
    logger.error(`[${sessionName ?? '?'}] 意图分类出错，默认过滤该消息 (${modelInfo}), query="${text}"`, err);
    return false;
  } finally {
    await modelService.dispose();
  }
}
