import { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { WsCommandType, WebChatEventType } from 'sbot.commons';
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

  // Track whether we're in a "restored" state (no active ChatSession)
  const restoredRef = useRef(false);

  // ── Restore pending approval/ask from server on mount ──
  useEffect(() => {
    void (async () => {
      const info = await client.fetchSessionStatus(sessionId);
      if (!info) return;

      if (info.status === 'waiting_approval' && info.pendingApproval) {
        const pa = info.pendingApproval;
        setHistory((prev) => [...prev, {
          type: 'toolCall' as const,
          id: uuidv4(),
          toolCallId: pa.id,
          name: pa.tool.name,
          args: pa.tool.args,
        }]);
        setPendingApproval({ id: pa.id, name: pa.tool.name, args: pa.tool.args });
        setStreamingState(StreamingState.Approval);
        restoredRef.current = true;
      } else if (info.status === 'waiting_ask' && info.pendingAsk) {
        const ask = info.pendingAsk;
        setPendingAsk({ id: ask.id, title: ask.title, questions: ask.questions });
        setStreamingState(StreamingState.Asking);
        restoredRef.current = true;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            if (event.type === WebChatEventType.Stream) {
              accumulated = extractText(event.content);
              setStreamingContent(accumulated);
            } else if (event.type === WebChatEventType.ToolCall) {
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
            } else if (event.type === WebChatEventType.Ask) {
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
            } else if (event.type === WebChatEventType.Message) {
              accumulated = '';
              setStreamingContent('');
              const content = extractText((event as any).content);
              const toolCallId = (event as any).tool_call_id as string | undefined;
              const toolCalls = (event as any).tool_calls as { id?: string; name: string; args: unknown }[] | undefined;

              if (toolCallId && content) {
                // Tool result — attach to matching tool call history item
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

              // AI message with tool_calls — create tool call history items
              if (toolCalls?.length) {
                const items: HistoryItem[] = toolCalls.map((tc) => ({
                  type: 'toolCall' as const,
                  id: uuidv4(),
                  toolCallId: tc.id ?? '',
                  name: tc.name,
                  args: tc.args,
                }));
                setHistory((prev) => [...prev, ...items]);
              }
            } else if (event.type === WebChatEventType.Error) {
              const errMsg: HistoryItem = {
                type: 'error',
                id: uuidv4(),
                message: (event as any).message ?? 'Unknown error',
              };
              setHistory((prev) => [...prev, errMsg]);
            } else if (event.type === WebChatEventType.Done) {
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
    const pending = pendingApproval;
    if (!pending) return;

    // Always send through the shared persistent WS
    client.send(sessionId, {
      type: WsCommandType.Approval,
      id: pending.id,
      approval,
    });

    setPendingApproval(null);
    if (restoredRef.current) {
      restoredRef.current = false;
      setStreamingState(StreamingState.Idle);
    } else {
      approvalResolveRef.current?.();
    }
  }, [client, sessionId, pendingApproval]);

  const resolveAsk = useCallback((answers: Record<string, string | string[]>) => {
    const pending = pendingAsk;
    if (!pending) return;

    // Always send through the shared persistent WS
    client.send(sessionId, {
      type: WsCommandType.Ask,
      id: pending.id,
      answers,
    });

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
    if (restoredRef.current) {
      restoredRef.current = false;
      setStreamingState(StreamingState.Idle);
    } else {
      askResolveRef.current?.();
    }
  }, [client, sessionId, pendingAsk]);

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
