import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback } from 'react';
import { Box, useApp } from 'ink';
import { StreamingState } from './types.js';
import { useChat } from './hooks/useChat.js';
import { useKeypress } from './hooks/useKeypress.js';
import { Header } from './components/Header.js';
import { Footer } from './components/Footer.js';
import { MessageList } from './components/MessageList.js';
import { InputPrompt } from './components/InputPrompt.js';
export const App = ({ client, config, agentName, saverName }) => {
    const { exit } = useApp();
    const { history, streamingContent, streamingState, submitQuery, cancelRequest, clearHistory } = useChat(client, config.agentId, config.saverId, config.memoryId);
    const isIdle = streamingState === StreamingState.Idle;
    const handleSubmit = useCallback(async (text) => {
        await submitQuery(text);
    }, [submitQuery]);
    const handleCancel = useCallback(() => {
        if (streamingState === StreamingState.Responding) {
            cancelRequest();
        }
        else {
            exit();
        }
    }, [streamingState, cancelRequest, exit]);
    // Global keys (Ctrl+L clear, Ctrl+C during stream)
    const handleGlobalKey = useCallback((key) => {
        if (key.ctrl && key.name === 'l') {
            clearHistory();
        }
        if (key.ctrl && key.name === 'c' && streamingState === StreamingState.Responding) {
            cancelRequest();
        }
    }, [streamingState, cancelRequest, clearHistory]);
    useKeypress(handleGlobalKey, { isActive: true });
    return (_jsxs(Box, { flexDirection: "column", height: "100%", children: [_jsx(Header, { agentName: agentName, saverName: saverName }), _jsx(MessageList, { history: history, streamingContent: streamingContent, isInputActive: isIdle }), _jsx(InputPrompt, { isActive: isIdle, onSubmit: handleSubmit, onCancel: handleCancel }), _jsx(Footer, { streamingState: streamingState })] }));
};
//# sourceMappingURL=App.js.map