import { StructuredToolInterface } from "@langchain/core/tools";

export interface IInsightService {
    /** insight 存储目录，供 SkillService 注册以加载已有 insight */
    getInsightDir(): string;
    /** 管理工具（create/patch/delete） */
    getTools(): StructuredToolInterface[];
    /** 根据 query 检索相关 insight，返回格式化的 system prompt 片段 */
    getRelevantInsights(query: string, limit?: number): Promise<string | null>;
}

export const IInsightService = Symbol("IInsightService");
