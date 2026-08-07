/**
 * Wiki 页面
 */
export interface WikiPage {
  id: string;
  title: string;
  content: string;
  tags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

