import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { StreamingState } from '../types.js';
export function useChat(client, agentId, saverId, memoryId) {
    const [history, setHistory] = useState([]);
    const [streamingContent, setStreamingContent] = useState('');
    const [streamingState, setStreamingState] = useState(StreamingState.Idle);
    const abortRef = useRef(null);
    const submitQuery = useCallback(async (query) => {
        if (streamingState !== StreamingState.Idle)
            return;
        // Add user message
        const userMsg = { type: 'user', id: uuidv4(), content: query };
        setHistory((prev) => [...prev, userMsg]);
        setStreamingState(StreamingState.Responding);
        setStreamingContent('');
        const abort = new AbortController();
        abortRef.current = abort;
        let accumulated = '';
        try {
            for await (const event of client.chatStream(query, agentId, saverId, memoryId, abort.signal)) {
                if (event.type === 'stream') {
                    accumulated = event.content ?? '';
                    setStreamingContent(accumulated);
                }
                else if (event.type === 'tool_call') {
                    // Commit accumulated streaming content first
                    if (accumulated) {
                        const assistantMsg = {
                            type: 'assistant',
                            id: uuidv4(),
                            content: accumulated,
                        };
                        setHistory((prev) => [...prev, assistantMsg]);
                        accumulated = '';
                        setStreamingContent('');
                    }
                    const toolMsg = {
                        type: 'tool_call',
                        id: uuidv4(),
                        name: event.name ?? '',
                        args: event.args,
                    };
                    setHistory((prev) => [...prev, toolMsg]);
                }
                else if (event.type === 'message') {
                    accumulated = '';
                    setStreamingContent('');
                    const content = event.content ?? '';
                    if (content) {
                        const msg = {
                            type: 'assistant',
                            id: uuidv4(),
                            content,
                        };
                        setHistory((prev) => [...prev, msg]);
                    }
                }
                else if (event.type === 'error') {
                    const errMsg = {
                        type: 'error',
                        id: uuidv4(),
                        message: event.message ?? 'Unknown error',
                    };
                    setHistory((prev) => [...prev, errMsg]);
                }
                else if (event.type === 'done') {
                    // Commit any remaining streamed content
                    if (accumulated) {
                        const assistantMsg = {
                            type: 'assistant',
                            id: uuidv4(),
                            content: accumulated,
                        };
                        setHistory((prev) => [...prev, assistantMsg]);
                    }
                    break;
                }
            }
        }
        catch (err) {
            if (err.name !== 'AbortError') {
                const errMsg = {
                    type: 'error',
                    id: uuidv4(),
                    message: err.message,
                };
                setHistory((prev) => [...prev, errMsg]);
            }
        }
        finally {
            setStreamingContent('');
            setStreamingState(StreamingState.Idle);
            abortRef.current = null;
        }
    }, [client, agentId, saverId, memoryId, streamingState]);
    const cancelRequest = useCallback(() => {
        abortRef.current?.abort();
    }, []);
    const clearHistory = useCallback(() => {
        setHistory([]);
    }, []);
    return { history, streamingContent, streamingState, submitQuery, cancelRequest, clearHistory };
}
//# sourceMappingURL=useChat.js.map