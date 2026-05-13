import { StructuredToolInterface } from "@langchain/core/tools";

export interface IInsightService {
    /** insight 存储目录，供 SkillService 注册以加载已有 insight */
    getInsightDir(): string;
    /** 管理工具（create/patch/delete） */
    getTools(): StructuredToolInterface[];
}

export const IInsightService = Symbol("IInsightService");
