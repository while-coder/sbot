import React, { useCallback, useMemo, useState } from 'react';
import { Box, Static, Text } from 'ink';
import ansiEscapes from 'ansi-escapes';
import type { SbotClient } from '../../api/sbotClient.js';
import { StreamingState } from '../types.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { HistoryItem } from './HistoryItem.js';
import { PendingZone } from './PendingZone.js';
import { InputPrompt } from './InputPrompt.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { useChatStream } from '../hooks/useChatStream.js';

interface ChatViewProps {
  client: SbotClient;
  sessionId: string;
  agentName: string;
  saverName: string;
  onExit: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  client,
  sessionId,
  agentName,
  saverName,
  onExit,
}) => {
  const {
    history, pendingContent, streamingState,
    pendingApproval, pendingAsk,
    submitQuery, resolveApproval, resolveAsk,
    cancelRequest,
  } = useChatStream(client, sessionId);

  const isIdle = streamingState === StreamingState.Idle;
  const [toolCallsExpanded, setToolCallsExpanded] = useState(false);
  const [remountKey, setRemountKey] = useState(0);

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
      onExit();
    }
  }, [streamingState, cancelRequest, onExit]);

  // Global keys (Tab fold, Ctrl+L clear, Ctrl+C cancel)
  const handleGlobalKey = useCallback(
    (key: Key) => {
      if (key.name === 'tab') {
        process.stdout.write(ansiEscapes.clearTerminal);
        setToolCallsExpanded((e) => !e);
        setRemountKey((k) => k + 1);
      }
      if (key.ctrl && key.name === 'l') {
        process.stdout.write(ansiEscapes.clearTerminal);
        setRemountKey((k) => k + 1);
      }
      if (key.ctrl && key.name === 'c') {
        if (streamingState === StreamingState.Responding) {
          cancelRequest();
        } else if (isIdle) {
          onExit();
        }
      }
    },
    [streamingState, isIdle, cancelRequest, onExit],
  );

  useKeypress(handleGlobalKey, { isActive: true });

  // Build the static items array: Header + completed history.
  // Memoized to avoid rebuilding on unrelated re-renders (e.g. pendingContent changes).
  const staticItems = useMemo(() => [
    <Header key="header" agentName={agentName} saverName={saverName} />,
    ...history.map((item) => (
      <HistoryItem key={item.id} item={item} toolCallsExpanded={toolCallsExpanded} />
    )),
  ], [history, toolCallsExpanded, agentName, saverName]);

  return (
    <ErrorBoundary>
      <Box flexDirection="column">
        <Static key={remountKey} items={staticItems}>
          {(item) => item}
        </Static>

        <PendingZone
          pendingContent={pendingContent}
          streamingState={streamingState}
          pendingApproval={pendingApproval}
          pendingAsk={pendingAsk}
          onResolveApproval={resolveApproval}
          onResolveAsk={resolveAsk}
        />

        {(isIdle || streamingState === StreamingState.Responding) && (
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
