import { Skill } from "../Skills/types";

export interface IInsightService {
    /** 根据 query 生成 insight 系统提示词 */
    getSystemMessage(query: string): Promise<string | null>;
    /** 根据 query 检索相关 insight，返回筛选后的 Skill 列表 */
    getRelevantInsights(query: string, limit?: number): Promise<Skill[]>;
    /** 从对话中静默提取 insight，post-turn 调用 */
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void>;
}

export const IInsightService = Symbol("IInsightService");
