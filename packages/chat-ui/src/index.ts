export type {
  RemoteEntry,
  SessionItem,
  AgentOption,
  SaverOption,
  MemoryOption,
  StoredMessage,
  ContentPart,
  Attachment,
  ChatLabels,
  DisplayPart,
  ToolCall,
  ChatMessage,
  WikiOption,
  CreateSessionOpts,
  UsageInfo,
  UsageData,
  ToolCallEvent,
  ToolApprovalType,
  ToolApprovalPayload,
  AskQuestionSpec,
  AskEvent,
  AskAnswerPayload,
  DisplayContent,
  DirListResult,
  QuickDir,
  AppSettings,
  SessionStatus,
  ChatEvent,
} from './types';

export { MessageRole, ContentPartType, AskQuestionType } from './types';

export type { IChatTransport } from './transport';

export { getContentParts, renderMd, fmtTs, fmtDateSep, toggleToolCall } from './messageRender';
export { inlineArgs, resultPreview } from './toolCallFormat';
export { defaultLabels, resolveLabels, tpl } from './labels';

// ── Transport implementations ──
export { WebSocketTransport } from './WebSocketTransport';

// ── Composables ──
export { useCompact, useCompactProvider } from './composables/useCompact';

// ── Components ──
export { default as ChatView } from './components/ChatView.vue';
export { default as ChatArea } from './components/ChatArea.vue';
export { default as SessionBar } from './components/SessionBar.vue';
export { default as ConfigToolbar } from './components/ConfigToolbar.vue';
export { default as StatusBar } from './components/StatusBar.vue';
export { default as ToolApprovalBar } from './components/ToolApprovalBar.vue';
export { default as AskForm } from './components/AskForm.vue';
export { default as MultiSelect } from './components/MultiSelect.vue';
export { default as PathPickerModal } from './components/PathPickerModal.vue';
export { default as MessageList } from './components/MessageList.vue';
export { default as MessageItem } from './components/MessageItem.vue';
export { default as RichInput } from './components/RichInput.vue';
export { default as ImageLightbox } from './components/ImageLightbox.vue';
export { default as ThinkDrawer } from './components/ThinkDrawer.vue';
export { default as ServerPicker } from './components/ServerPicker.vue';
