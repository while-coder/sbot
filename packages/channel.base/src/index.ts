export { ChannelSessionHandler, ToolCallStatus } from './ChannelSessionHandler';
export {
  ChannelPlugin, ChannelPluginContext, ChannelMessageArgs, InitSessionContext, ChannelSessionInfo,
  IChannelService, ChannelToolHelpers, ProcessAIHandler,
  ConfigFieldType, ConfigField,
} from './ChannelPlugin';
export { AbstractChatProvider } from './AbstractChatProvider';
export { parseMessages2Text } from './ProviderMessage';
export { SessionManager } from './SessionManager';
export { SessionService, SessionSettings, SessionStatus, SessionInfo, AskInfo, ApprovalInfo, CancellationTokenSource } from './SessionService';

// Re-export scorpio.ai types for channel implementations
export { GlobalLoggerService, type ILogger } from "scorpio.ai";
export { MessageRole, NowDate, parseJson, AskQuestionType } from "scorpio.ai";
export { ToolApproval } from "scorpio.ai";
export type { ChatMessage, ChatToolCall, AskToolParams, MessageType, MessageContent } from "scorpio.ai";
export { contentToString, isEmptyContent, readImageAsDataUrl, readMediaAsContentPart, detectMediaType } from "scorpio.ai";
export type { MediaCategory, ContentPart } from "scorpio.ai";
