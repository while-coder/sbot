import { ExtractedKnowledge } from "../Types";

/**
 * Wiki 知识提取器接口
 * 从对话中提取结构化知识
 */
export interface IWikiExtractor {
    extract(
        userMessage: string,
        assistantMessages: string[],
        existingTitles: string[]
    ): Promise<ExtractedKnowledge[]>;
}

export const IWikiExtractor = Symbol("IWikiExtractor");
