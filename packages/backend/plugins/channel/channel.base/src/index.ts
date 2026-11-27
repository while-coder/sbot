export { ChannelSessionHandler, ToolCallStatus } from './ChannelSessionHandler';
export {
  ChannelPlugin, ChannelPluginContext, ChannelMessageArgs, InitSessionContext, ChannelSessionInfo,
  IChannelService, ProcessAIHandler,
  ChannelCapability,
  ConfigFieldType, ConfigField,
  defineChannelPlugin,
} from './ChannelPlugin';
export { AbstractChatProvider } from './AbstractChatProvider';
export {
  AskQuestionType,
  type AskToolParams, type AskQuestion, type AskResponse,
  type RadioQuestion, type CheckboxQuestion, type InputQuestion,
} from './AskTool';
export { createAgentTool, type AgentTool, type ToolInvokeConfig } from 'scorpio.ai';
export { parseMessages2Text } from './ProviderMessage';
export { SessionManager } from './SessionManager';
export { SessionService, SessionSettings, SessionStatus, SessionInfo, AskInfo, ApprovalInfo } from './SessionService';

// Re-export scorpio.ai types for channel implementations
export { GlobalLoggerService, type ILogger } from "scorpio.ai";
export { MessageRole, parseJson, TimeUtils, formatError } from "scorpio.ai";
export { ToolApproval, AgentCancelledError } from "scorpio.ai";
export type { ChatMessage, ChatToolCall, MessageType, MessageContent, AttachmentInput } from "scorpio.ai";
export { contentToString, trimContent, isEmptyContent, readImageAsDataUrl, readMediaAsContentPart, detectMediaType, summarizeMultimodal } from "scorpio.ai";
export { appendIncomingAttachments, incomingFileAttachment, incomingBufferAttachment } from "scorpio.ai";
export type { MediaCategory, ContentPart } from "scorpio.ai";
