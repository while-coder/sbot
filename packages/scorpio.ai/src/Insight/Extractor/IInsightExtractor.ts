export const enum InsightAction {
    Create = 'create',
    Patch = 'patch',
    Delete = 'delete',
}

export interface ExtractedInsight {
    name: string;
    description: string;
    content: string;
    action: InsightAction;
    patchTarget?: string;
}

export interface IInsightExtractor {
    extract(userMessage: string, assistantMessages: string[], existingNames: string[]): Promise<ExtractedInsight[]>;
}

export const IInsightExtractor = Symbol("IInsightExtractor");
