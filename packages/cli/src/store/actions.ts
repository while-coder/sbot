import { v4 as uuidv4 } from 'uuid';
import { WebChatEventType } from 'sbot.commons';
import type { AppStateStore } from './AppStateStore.js';
import type { PendingAttachment } from '../ui/utils/fileAttachment.js';
import { prepareMessage } from '../ui/utils/fileAttachment.js';
import type { HistoryItem, PendingApproval, PendingAsk } from '../ui/types.js';
import { StreamingState } from '../ui/types.js';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (typeof block === 'string' ? block : block?.text ?? ''))
      .join('');
  }
  return '';
}

let abortController: AbortController | null = null;
let restoredFromServer = false;

function commitText(store: AppStateStore, text: string): void {
  if (!text) return;
  store.appendHistory({ type: 'assistant', id: uuidv4(), content: text });
}

export async function restoreSessionStatus(store: AppStateStore): Promise<void> {
  const { client } = store;
  const profileId = store.getState().profileId;
  if (!client || !profileId) return;

  const info = await client.fetchSessionStatus(profileId);
  if (!info) return;

  if (info.pendingApproval) {
    const pa = info.pendingApproval;
    store.appendHistory({
      type: 'toolCall',
      id: uuidv4(),
      toolCallId: pa.id,
      name: pa.tool.name,
      args: pa.tool.args,
    });
    store.setState({
      pendingApproval: { id: pa.id, name: pa.tool.name, args: pa.tool.args },
      streamingState: StreamingState.Approval,
    });
    restoredFromServer = true;
  } else if (info.pendingAsk) {
    const ask = info.pendingAsk;
    store.setState({
      pendingAsk: { id: ask.id, title: ask.title, questions: ask.questions },
      streamingState: StreamingState.Asking,
    });
    restoredFromServer = true;
  }
}

export async function submitQuery(
  store: AppStateStore,
  query: string,
  pendingAttachments?: PendingAttachment[],
): Promise<void> {
  const state = store.getState();
  if (state.streamingState !== StreamingState.Idle) return;
  if (!store.client || !state.profileId) return;

  const attNames = pendingAttachments?.map(a => a.name);
  const userMsg: HistoryItem = {
    type: 'user', id: uuidv4(), content: query,
    ...(attNames?.length ? { attachments: attNames } : {}),
  };
  store.appendHistory(userMsg);
  if (query.trim()) {
    store.addInputHistory(query.trim());
  }
  store.setState({ streamingState: StreamingState.Responding, pendingContent: '' });

  const prepared = prepareMessage(query, pendingAttachments ?? []);
  const abort = new AbortController();
  abortController = abort;
  restoredFromServer = false;

  const chat = store.client.openChatSession(
    query, state.profileId, abort.signal, prepared.parts, prepared.attachments,
  );

  let accumulated = '';

  try {
    for await (const event of chat.events_iter()) {
      try {
        const d = (event as any).data;

        if (event.type === WebChatEventType.Stream) {
          accumulated = extractText(d.content);
          store.setState({ pendingContent: accumulated });

        } else if (event.type === WebChatEventType.ToolCall) {
          store.appendHistory({
            type: 'toolCall',
            id: uuidv4(),
            toolCallId: d.toolCallId ?? d.approvalId,
            name: d.name ?? '',
            args: d.args ?? {},
          });
          const pending: PendingApproval = {
            id: d.approvalId,
            name: d.name ?? '',
            args: d.args ?? {},
          };
          store.setState({ pendingApproval: pending, streamingState: StreamingState.Approval });

        } else if (event.type === WebChatEventType.ApprovalDone) {
          if (store.getState().pendingApproval?.id === d.id) {
            store.setState({ pendingApproval: null, streamingState: StreamingState.Responding });
          }

        } else if (event.type === WebChatEventType.Ask) {
          const pending: PendingAsk = { id: d.id, title: d.title, questions: d.questions ?? [] };
          store.setState({ pendingAsk: pending, streamingState: StreamingState.Asking });

        } else if (event.type === WebChatEventType.AskDone) {
          if (store.getState().pendingAsk?.id === d.id) {
            store.setState({ pendingAsk: null, streamingState: StreamingState.Responding });
          }

        } else if (event.type === WebChatEventType.Message) {
          accumulated = '';
          store.setState({ pendingContent: '' });
          const msg = d.message;
          const content = extractText(msg?.content);
          const toolCallId = msg?.tool_call_id as string | undefined;
          const toolCalls = msg?.tool_calls as { id?: string; name: string; args: unknown }[] | undefined;

          if (toolCallId && content) {
            const history = store.getState().history;
            store.setState({
              history: history.map((item) =>
                item.type === 'toolCall' && item.toolCallId === toolCallId
                  ? { ...item, result: content }
                  : item,
              ),
            });
          } else if (content) {
            commitText(store, content);
          }

          if (toolCalls?.length) {
            const items: HistoryItem[] = toolCalls.map((tc) => ({
              type: 'toolCall' as const,
              id: uuidv4(),
              toolCallId: tc.id ?? '',
              name: tc.name,
              args: tc.args,
            }));
            for (const item of items) store.appendHistory(item);
          }

        } else if (event.type === WebChatEventType.Error) {
          store.appendHistory({
            type: 'error',
            id: uuidv4(),
            message: d.message ?? 'Unknown error',
          });

        } else if (event.type === WebChatEventType.Done) {
          if (accumulated) commitText(store, accumulated);
          break;
        }
      } catch (eventErr) {
        store.appendHistory({
          type: 'error',
          id: uuidv4(),
          message: `Event error: ${(eventErr as Error).message}`,
        });
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      store.appendHistory({
        type: 'error',
        id: uuidv4(),
        message: (err as Error).message,
      });
    }
  } finally {
    store.setState({
      pendingContent: '',
      streamingState: StreamingState.Idle,
      pendingApproval: null,
      pendingAsk: null,
    });
    abortController = null;
  }
}

export function resolveApproval(store: AppStateStore, approval: string): void {
  const state = store.getState();
  const pending = state.pendingApproval;
  if (!pending || !store.client || !state.profileId) return;

  store.client.approveToolCall(state.profileId, pending.id, approval);

  store.setState({
    pendingApproval: null,
    streamingState: restoredFromServer ? StreamingState.Idle : StreamingState.Responding,
  });
  if (restoredFromServer) {
    restoredFromServer = false;
  }
}

export function resolveAsk(
  store: AppStateStore,
  answers: Record<string, string | string[]>,
): void {
  const state = store.getState();
  const pending = state.pendingAsk;
  if (!pending || !store.client || !state.profileId) return;

  store.client.answerAsk(state.profileId, pending.id, answers);

  const answerDisplay: Record<string, string | string[]> = {};
  for (const [key, val] of Object.entries(answers)) {
    const idx = parseInt(key, 10);
    const q = pending.questions[idx];
    if (q) answerDisplay[q.label] = val;
    else answerDisplay[key] = val;
  }
  store.appendHistory({
    type: 'ask',
    id: uuidv4(),
    title: pending.title,
    answers: answerDisplay,
  });

  store.setState({
    pendingAsk: null,
    streamingState: restoredFromServer ? StreamingState.Idle : StreamingState.Responding,
  });
  if (restoredFromServer) {
    restoredFromServer = false;
  }
}

export function cancelRequest(store: AppStateStore): void {
  const { profileId } = store.getState();
  if (store.client && profileId) store.client.abort(profileId);
  abortController?.abort();
  abortController = null;
  restoredFromServer = false;
  store.setState({
    pendingContent: '',
    pendingApproval: null,
    pendingAsk: null,
    streamingState: StreamingState.Idle,
  });
}
