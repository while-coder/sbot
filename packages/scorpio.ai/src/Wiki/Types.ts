/**
 * Wiki 页面来源
 */
export type WikiPageSource = 'conversation' | 'manual' | 'merge';

/**
 * Wiki 页面
 */
export interface WikiPage {
  id: string;
  title: string;
  content: string;
  tags: string[];
  links: string[];
  metadata: Record<string, any>;
  version: number;
  source: WikiPageSource;
  createdAt: number;
  updatedAt: number;
}

/**
 * Wiki 搜索结果
 */
export interface WikiSearchResult {
  page: WikiPage;
  score: number;
  snippet: string;
}

/**
 * 从对话中提取的知识
 */
export interface ExtractedKnowledge {
  title: string;
  content: string;
  tags: string[];
  shouldMergeWith?: string;
}
