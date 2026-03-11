import React, { useCallback } from 'react';
import { Box, useApp } from 'ink';
import type { SbotClient } from '../api/sbotClient.js';
import type { LocalConfig } from '../config/localConfig.js';
import { StreamingState } from './types.js';
import { useChat } from './hooks/useChat.js';
import { useKeypress, type Key } from './hooks/useKeypress.js';
import { Header } from './components/Header.js';
import { Footer } from './components/Footer.js';
import { MessageList } from './components/MessageList.js';
import { InputPrompt } from './components/InputPrompt.js';

interface AppProps {
  client: SbotClient;
  config: LocalConfig;
  agentName: string;
  saverName: string;
}

export const App: React.FC<AppProps> = ({ client, config, agentName, saverName }) => {
  const { exit } = useApp();
  const { history, streamingContent, streamingState, submitQuery, cancelRequest, clearHistory } =
    useChat(client, config.agentId, config.saverId, config.memoryId);

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
      <InputPrompt
        isActive={isIdle}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
      <Footer streamingState={streamingState} />
    </Box>
  );
};
