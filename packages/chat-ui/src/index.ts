export type {
  RemoteEntry,
  SessionItem,
  AgentOption,
  SaverOption,
  NoteOption,
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
  ToolApprovalPayload,
  AskQuestionSpec,
  AskEvent,
  AskAnswerPayload,
  DisplayContent,
  DirListResult,
  DriveEntry,
  QuickDir,
  FsTreeItem,
  FsTreeResult,
  FsReadResult,
  AppSettings,
  SessionStatus,
  ChatEvent,
} from './types';

export { MessageRole, MessageKind, ContentPartType, AskQuestionType, ChatEventType, ToolApproval } from './types';

export type { IChatTransport } from './transport';

export { getContentParts, renderMd, fmtTs, fmtDateSep, toggleToolCall } from './messageRender';
export { inlineArgs, resultPreview } from './toolCallFormat';
export { defaultLabels, resolveLabels, tpl } from './labels';

// ── Transport implementations ──
export { WebSocketTransport } from './WebSocketTransport';

// ── Composables ──
export { useCompact, useCompactProvider } from './composables/useCompact'
export { useAttachments } from './composables/useAttachments';

// ── Components ──
export { default as ChatView } from './components/ChatView.vue';
export { default as ChatArea } from './components/ChatArea.vue';
export { default as SessionBar } from './components/SessionBar.vue';
export { default as ConfigToolbar } from './components/ConfigToolbar.vue';
export { default as StatusBar } from './components/StatusBar.vue';
export { default as ToolApprovalBar } from './components/ToolApprovalBar.vue';
export { default as AskForm } from './components/AskForm.vue';
export { default as PathPickerModal } from './components/PathPickerModal.vue';
export { default as MessageList } from './components/MessageList.vue';
export { default as RichInput } from './components/RichInput.vue';
export { default as ImageLightbox } from './components/ImageLightbox.vue';
export { default as ThinkDrawer } from './components/ThinkDrawer.vue';
export { default as ServerPicker } from './components/ServerPicker.vue';
export { default as WorkbenchPanel } from './components/WorkbenchPanel.vue';
export { default as Terminal } from './components/Terminal.vue';
export { default as FileExplorer } from './components/FileExplorer.vue';
export { default as GitExplorer } from './components/GitExplorer.vue';
export { default as CodeViewer } from './components/CodeViewer.vue';
