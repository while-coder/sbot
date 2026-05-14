export interface ExtractedInsight {
    name: string;
    description: string;
    content: string;
    action: 'create' | 'patch';
    patchTarget?: string;
}

export interface IInsightExtractor {
    extract(userMessage: string, assistantMessages: string[], existingNames: string[]): Promise<ExtractedInsight[]>;
}

export const IInsightExtractor = Symbol("IInsightExtractor");
