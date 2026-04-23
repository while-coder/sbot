export { ChannelSessionHandler, ToolCallStatus } from './ChannelSessionHandler';
export {
  ChannelPlugin, ChannelPluginContext, ChannelMessageArgs, InitSessionContext, ChannelSessionInfo,
  IChannelService, ProcessAIHandler,
  ConfigFieldType, ConfigField,
} from './ChannelPlugin';
export { AbstractChatProvider } from './AbstractChatProvider';
export { createSendFileTool, SEND_FILE_TOOL_NAME, type SendFileFn } from './SendFileTool';
export {
  createAskTool, ASK_TOOL_NAME, AskQuestionType,
  type AskToolParams, type AskQuestion, type AskResponse, type AskUserFn,
  type RadioQuestion, type CheckboxQuestion, type InputQuestion,
} from './AskTool';
export { type StructuredToolInterface } from '@langchain/core/tools';
export { parseMessages2Text } from './ProviderMessage';
export { SessionManager } from './SessionManager';
export { SessionService, SessionSettings, SessionStatus, SessionInfo, AskInfo, ApprovalInfo, CancellationTokenSource } from './SessionService';

// Re-export scorpio.ai types for channel implementations
export { GlobalLoggerService, type ILogger } from "scorpio.ai";
export { MessageRole, NowDate, parseJson } from "scorpio.ai";
export { ToolApproval } from "scorpio.ai";
export type { ChatMessage, ChatToolCall, MessageType, MessageContent } from "scorpio.ai";
export { contentToString, isEmptyContent, readImageAsDataUrl, readMediaAsContentPart, detectMediaType } from "scorpio.ai";
export type { MediaCategory, ContentPart } from "scorpio.ai";
