import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { SbotClient } from '../../api/sbotClient.js';
import type { HistoryItem } from '../types.js';
import { StreamingState } from '../types.js';

export interface UseChatReturn {
  history: HistoryItem[];
  streamingContent: string;
  streamingState: StreamingState;
  submitQuery: (query: string) => Promise<void>;
  cancelRequest: () => void;
  clearHistory: () => void;
}

export function useChat(
  client: SbotClient,
  agentId: string,
  saverId: string,
  memoryId: string | null,
): UseChatReturn {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingState, setStreamingState] = useState<StreamingState>(StreamingState.Idle);
  const abortRef = useRef<AbortController | null>(null);

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

      let accumulated = '';

      try {
        for await (const event of client.chatStream(query, agentId, saverId, memoryId, abort.signal)) {
          if (event.type === 'stream') {
            accumulated += event.content ?? '';
            setStreamingContent(accumulated);
          } else if (event.type === 'tool_call') {
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
            const toolMsg: HistoryItem = {
              type: 'tool_call',
              id: uuidv4(),
              name: event.name ?? '',
              args: event.args,
            };
            setHistory((prev) => [...prev, toolMsg]);
          } else if (event.type === 'message') {
            accumulated = '';
            setStreamingContent('');
            const content = (event.content as string) ?? '';
            if (content) {
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
              message: event.message ?? 'Unknown error',
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
        abortRef.current = null;
      }
    },
    [client, agentId, saverId, memoryId, streamingState],
  );

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return { history, streamingContent, streamingState, submitQuery, cancelRequest, clearHistory };
}
