export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export enum MessageRole {
  Human = "human",
  AI = "ai",
  Tool = "tool",
  System = "system",
}

export interface ChatToolCall {
  id?: string;
  name: string;
  args: Record<string, any>;
  type?: string;
}

export const ContentPartType = {
  Text: "text",
  Image: "image",
  ImageUrl: "image_url",
  Audio: "audio",
} as const;

export type ContentPartType = typeof ContentPartType[keyof typeof ContentPartType];

interface TextPart {
  type: "text";
  text: string;
  cache_control?: any;
}

interface ImagePart {
  type: "image";
  data: string;
  mimeType?: string;
}

interface ImageUrlPart {
  type: "image_url";
  image_url: { url: string };
  mimeType?: string;
}

interface AudioPart {
  type: "audio";
  data: string;
  mimeType?: string;
}

export type ContentPart =
  | TextPart
  | ImagePart
  | ImageUrlPart
  | AudioPart
  | { type: string; [key: string]: any };

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
  status?: string;
  id?: string;
  additional_kwargs?: Record<string, any>;
  usage?: TokenUsage;
}

export type MessageContent = ChatMessage["content"];

export interface AttachmentInput {
  name: string;
  dataUrl?: string;
  content?: string;
}
