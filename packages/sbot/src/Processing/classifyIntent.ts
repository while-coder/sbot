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

const DEFAULT_INTENT_PROMPT = `You are a group chat message intent classifier. Determine whether a message is seeking help from the AI assistant.

## Should reply (shouldReply=true)
- Open-ended questions not directed at a specific person (e.g. "Does anyone know how to...", "What does XXX mean")
- Explicit requests for help, advice, or technical answers
- Follow-up questions or additions to a previous AI response

## Should NOT reply (shouldReply=false)
- Conversations between members: questions directed at a specific person by name, replies to a specific person, context clearly indicates human-to-human exchange
- Social messages: greetings, thanks, emoji reactions, polls, casual chat
- Informational notices: group announcements, system notifications, shared links/articles/images without questions
- Brief acknowledgments: OK, got it, thanks, +1, done, etc.
- Commands/approvals: leave notices, meeting notices, approval workflow messages

## Guiding principles
1. Core criterion: Does the sender expect a reply from the AI?
2. Human conversation takes priority: if the message seems directed at another person in the group, do not reply
3. When in doubt, stay silent: if you are not confident that shouldReply should be true, always return shouldReply=false with lower confidence. Err on the side of silence.`;

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
): Promise<boolean> {
  const modelService = await config.getModelService(intentModelId);
  if (!modelService) return true;

  try {
    const result = await modelService.invokeStructured<IntentResult>(IntentSchema, [
      { role: MessageRole.System, content: intentPrompt || DEFAULT_INTENT_PROMPT },
      { role: MessageRole.Human, content: query },
    ], { signal: AbortSignal.timeout(120_000) });

    const shouldReply = result.shouldReply && result.confidence >= intentThreshold;
    if (!shouldReply) {
      const text = typeof query === 'string'
        ? query
        : query.filter(b => b.type === 'text').map(b => b.text).join('\n');
      logger.info(`意图过滤: "${text.length > 80 ? text.slice(0, 80) + '...' : text}" (置信度=${result.confidence}, 阈值=${intentThreshold}, 原因=${result.reasoning})`);
    }
    return shouldReply;
  } catch (err) {
    logger.error("意图分类出错，默认过滤该消息", err);
    return false;
  } finally {
    await modelService.dispose();
  }
}
