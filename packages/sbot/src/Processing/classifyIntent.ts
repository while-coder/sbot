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

const DEFAULT_INTENT_PROMPT = `你是群聊消息意图分类器。判断一条群聊消息是否在向 AI 助手寻求帮助。

## 应回复（shouldReply=true）
- 开放式提问，未指定回答人（如"有人知道怎么…吗""XXX 是什么意思"）
- 明确寻求帮助、建议或技术解答的请求
- 对 AI 先前回复的追问或补充

## 不应回复（shouldReply=false）
- 成员之间的对话：指名道姓提问、回复特定人、讨论上下文明确是人与人交流
- 社交性消息：问候、感谢、表情、接龙、投票、日常闲聊
- 信息通知类：群公告、系统通知、分享链接/文章/图片且无提问
- 简短回应：好的、收到、OK、+1、已处理等确认性回复
- 纯指令/审批类：请假通知、会议通知、审批流消息

## 判断原则
1. 核心标准：消息发送者是否期望从 AI 获得回复？
2. 人际对话优先：如果消息更像是对群里某个人说的，不应回复
3. 宁可漏回不误回：不确定时倾向 shouldReply=false、降低 confidence`;

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
    const result = await modelService.invokeStructured<IntentResult>(IntentSchema, [
      { role: MessageRole.System, content: intentPrompt || DEFAULT_INTENT_PROMPT },
      { role: MessageRole.Human, content: query },
    ]);

    const shouldReply = result.shouldReply && result.confidence >= intentThreshold;
    if (!shouldReply) {
      const text = typeof query === 'string'
        ? query
        : query.filter(b => b.type === 'text').map(b => b.text).join('\n');
      logger.info(`意图过滤: "${text.length > 80 ? text.slice(0, 80) + '...' : text}" → 已过滤 (confidence=${result.confidence}, threshold=${intentThreshold}, reasoning=${result.reasoning})`);
    }
    return shouldReply;
  } catch {
    return true;
  } finally {
    await modelService.dispose();
  }
}
