import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { SbotClient, ChatSession } from '../../api/sbotClient.js';
import type { HistoryItem, PendingApproval, PendingAsk } from '../types.js';
import { StreamingState } from '../types.js';

export interface UseChatReturn {
  history: HistoryItem[];
  streamingContent: string;
  streamingState: StreamingState;
  pendingApproval: PendingApproval | null;
  pendingAsk: PendingAsk | null;
  submitQuery: (query: string) => Promise<void>;
  resolveApproval: (approval: string) => void;
  resolveAsk: (answers: Record<string, string | string[]>) => void;
  cancelRequest: () => void;
  clearHistory: () => void;
}

/** Extract plain text from content that may be a string or an array of content blocks */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (typeof block === 'string' ? block : block?.text ?? ''))
      .join('');
  }
  return '';
}

export function useChat(
  client: SbotClient,
  sessionId: string,
): UseChatReturn {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingState, setStreamingState] = useState<StreamingState>(StreamingState.Idle);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);

  // Resolve callbacks — stored as refs so the event loop can await them
  const approvalResolveRef = useRef<(() => void) | null>(null);
  const askResolveRef = useRef<(() => void) | null>(null);

  const submitQuery = useCallback(
    async (query: string) => {
      if (streamingState !== StreamingState.Idle) return;

      // Add user message
      const userMsg: HistoryItem = { type: 'user', id: uuidv4(), content: query };
      setHistory((prev) => [...prev, userMsg]);
      setStreamingState(StreamingState.Responding);
      setStreamingContent('');

      const abort = new AbortController();
      abortRef.current = abort;

      const chat = client.openChatSession(query, sessionId, abort.signal);
      sessionRef.current = chat;

      let accumulated = '';

      try {
        for await (const event of chat.events_iter()) {
          try {
            if (event.type === 'stream') {
              accumulated = extractText(event.content);
              setStreamingContent(accumulated);
            } else if (event.type === 'toolCall') {
              // Commit accumulated streaming content first
              if (accumulated) {
                const assistantMsg: HistoryItem = {
                  type: 'assistant',
                  id: uuidv4(),
                  content: accumulated,
                };
                setHistory((prev) => [...prev, assistantMsg]);
                accumulated = '';
                setStreamingContent('');
              }
              // Show tool call in history
              const toolCallId = (event as any).id ?? '';
              const toolMsg: HistoryItem = {
                type: 'toolCall',
                id: uuidv4(),
                toolCallId,
                name: (event as any).name ?? '',
                args: (event as any).args,
              };
              setHistory((prev) => [...prev, toolMsg]);

              // Enter approval mode and pause event loop
              const pending: PendingApproval = {
                id: (event as any).id,
                name: (event as any).name ?? '',
                args: (event as any).args ?? {},
              };
              setPendingApproval(pending);
              setStreamingState(StreamingState.Approval);

              // Wait until user resolves approval
              await new Promise<void>((resolve) => {
                approvalResolveRef.current = resolve;
              });
              approvalResolveRef.current = null;

              // Back to responding
              setStreamingState(StreamingState.Responding);
            } else if (event.type === 'ask') {
              // Commit accumulated streaming content first
              if (accumulated) {
                const assistantMsg: HistoryItem = {
                  type: 'assistant',
                  id: uuidv4(),
                  content: accumulated,
                };
                setHistory((prev) => [...prev, assistantMsg]);
                accumulated = '';
                setStreamingContent('');
              }

              // Enter ask mode and pause event loop
              const pending: PendingAsk = {
                id: (event as any).id,
                title: (event as any).title,
                questions: (event as any).questions ?? [],
              };
              setPendingAsk(pending);
              setStreamingState(StreamingState.Asking);

              // Wait until user resolves ask
              await new Promise<void>((resolve) => {
                askResolveRef.current = resolve;
              });
              askResolveRef.current = null;

              // Back to responding
              setStreamingState(StreamingState.Responding);
            } else if (event.type === 'message') {
              accumulated = '';
              setStreamingContent('');
              const content = extractText((event as any).content);
              const toolCallId = (event as any).tool_call_id as string | undefined;
              if (toolCallId && content) {
                // Attach result to matching tool call history item
                setHistory((prev) => prev.map((item) =>
                  item.type === 'toolCall' && item.toolCallId === toolCallId
                    ? { ...item, result: content }
                    : item,
                ));
              } else if (content) {
                const msg: HistoryItem = {
                  type: 'assistant',
                  id: uuidv4(),
                  content,
                };
                setHistory((prev) => [...prev, msg]);
              }
            } else if (event.type === 'error') {
              const errMsg: HistoryItem = {
                type: 'error',
                id: uuidv4(),
                message: (event as any).message ?? 'Unknown error',
              };
              setHistory((prev) => [...prev, errMsg]);
            } else if (event.type === 'done') {
              // Commit any remaining streamed content
              if (accumulated) {
                const assistantMsg: HistoryItem = {
                  type: 'assistant',
                  id: uuidv4(),
                  content: accumulated,
                };
                setHistory((prev) => [...prev, assistantMsg]);
              }
              break;
            }
          } catch (eventErr) {
            // Single event processing error — show it but keep the stream alive
            setHistory((prev) => [...prev, {
              type: 'error' as const,
              id: uuidv4(),
              message: `Event error: ${(eventErr as Error).message}`,
            }]);
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const errMsg: HistoryItem = {
            type: 'error',
            id: uuidv4(),
            message: (err as Error).message,
          };
          setHistory((prev) => [...prev, errMsg]);
        }
      } finally {
        setStreamingContent('');
        setStreamingState(StreamingState.Idle);
        setPendingApproval(null);
        setPendingAsk(null);
        abortRef.current = null;
        sessionRef.current = null;
      }
    },
    [client, sessionId, streamingState],
  );

  const resolveApproval = useCallback((approval: string) => {
    const chat = sessionRef.current;
    const pending = pendingApproval;
    if (!chat || !pending) return;
    chat.sendApproval(pending.id, approval);
    setPendingApproval(null);
    approvalResolveRef.current?.();
  }, [pendingApproval]);

  const resolveAsk = useCallback((answers: Record<string, string | string[]>) => {
    const chat = sessionRef.current;
    const pending = pendingAsk;
    if (!chat || !pending) return;
    chat.sendAsk(pending.id, answers);

    // Record in history
    const answerDisplay: Record<string, string | string[]> = {};
    for (const [key, val] of Object.entries(answers)) {
      const idx = parseInt(key, 10);
      const q = pending.questions[idx];
      if (q) answerDisplay[q.label] = val;
      else answerDisplay[key] = val;
    }
    setHistory((prev) => [...prev, {
      type: 'ask' as const,
      id: uuidv4(),
      title: pending.title,
      answers: answerDisplay,
    }]);

    setPendingAsk(null);
    askResolveRef.current?.();
  }, [pendingAsk]);

  const cancelRequest = useCallback(() => {
    // If in approval/ask mode, also unblock the event loop
    approvalResolveRef.current?.();
    askResolveRef.current?.();
    abortRef.current?.abort();
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    history, streamingContent, streamingState,
    pendingApproval, pendingAsk,
    submitQuery, resolveApproval, resolveAsk,
    cancelRequest, clearHistory,
  };
}
