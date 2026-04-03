import React, { useCallback } from 'react';
import { Box, useApp } from 'ink';
import type { SbotClient } from '../api/sbotClient.js';
import { StreamingState } from './types.js';
import { useChat } from './hooks/useChat.js';
import { useKeypress, type Key } from './hooks/useKeypress.js';
import { Header } from './components/Header.js';
import { Footer } from './components/Footer.js';
import { MessageList } from './components/MessageList.js';
import { InputPrompt } from './components/InputPrompt.js';
import { ApprovalPrompt } from './components/ApprovalPrompt.js';
import { AskPrompt } from './components/AskPrompt.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

interface AppProps {
  client: SbotClient;
  sessionId: string;
  agentName: string;
  saverName: string;
}

export const App: React.FC<AppProps> = ({ client, sessionId, agentName, saverName }) => {
  const { exit } = useApp();
  const {
    history, streamingContent, streamingState,
    pendingApproval, pendingAsk,
    submitQuery, resolveApproval, resolveAsk,
    cancelRequest, clearHistory,
  } = useChat(client, sessionId);

  const isIdle = streamingState === StreamingState.Idle;

  const handleSubmit = useCallback(
    async (text: string) => {
      await submitQuery(text);
    },
    [submitQuery],
  );

  const handleCancel = useCallback(() => {
    if (streamingState === StreamingState.Responding) {
      cancelRequest();
    } else {
      exit();
    }
  }, [streamingState, cancelRequest, exit]);

  // Global keys (Ctrl+L clear, Ctrl+C during stream)
  const handleGlobalKey = useCallback(
    (key: Key) => {
      if (key.ctrl && key.name === 'l') {
        clearHistory();
      }
      if (key.ctrl && key.name === 'c' && streamingState === StreamingState.Responding) {
        cancelRequest();
      }
    },
    [streamingState, cancelRequest, clearHistory],
  );

  useKeypress(handleGlobalKey, { isActive: true });

  return (
    <ErrorBoundary>
      <Box flexDirection="column" height="100%">
        <Header
          agentName={agentName}
          saverName={saverName}
        />
        <MessageList
          history={history}
          streamingContent={streamingContent}
          isInputActive={isIdle}
        />
        {streamingState === StreamingState.Approval && pendingApproval && (
          <ApprovalPrompt pending={pendingApproval} onResolve={resolveApproval} />
        )}
        {streamingState === StreamingState.Asking && pendingAsk && (
          <AskPrompt pending={pendingAsk} onResolve={resolveAsk} />
        )}
        {(streamingState === StreamingState.Idle || streamingState === StreamingState.Responding) && (
          <InputPrompt
            isActive={isIdle}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
          />
        )}
        <Footer streamingState={streamingState} />
      </Box>
    </ErrorBoundary>
  );
};
