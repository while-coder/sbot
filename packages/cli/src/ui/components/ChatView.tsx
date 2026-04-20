import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Static, Text } from 'ink';
import ansiEscapes from 'ansi-escapes';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { useStore } from '../../store/useStore.js';
import {
  submitQuery,
  resolveApproval,
  resolveAsk,
  cancelRequest,
  restoreSessionStatus,
} from '../../store/actions.js';
import type { AppStateStore } from '../../store/AppStateStore.js';
import type { CommandRegistry } from '../../commands/registry.js';
import { StreamingState } from '../types.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { HistoryItem } from './HistoryItem.js';
import { PendingZone } from './PendingZone.js';
import { InputPrompt, type PendingAttachment } from './InputPrompt.js';
import { ErrorBoundary } from './ErrorBoundary.js';

interface ChatViewProps {
  store: AppStateStore;
  registry: CommandRegistry;
  onExit: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  store,
  registry,
  onExit,
}) => {
  const history = useStore(s => s.history);
  const pendingContent = useStore(s => s.pendingContent);
  const streamingState = useStore(s => s.streamingState);
  const pendingApproval = useStore(s => s.pendingApproval);
  const pendingAsk = useStore(s => s.pendingAsk);
  const agentName = useStore(s => s.agentName);
  const saverName = useStore(s => s.saverName);
  const toolCallsExpanded = useStore(s => s.toolCallsExpanded);

  const isIdle = streamingState === StreamingState.Idle;
  const [remountKey, setRemountKey] = useState(0);

  useEffect(() => {
    void restoreSessionStatus(store);
  }, [store]);

  const handleSubmit = useCallback(
    async (text: string, attachments: PendingAttachment[]) => {
      if (text.startsWith('/') && text.trim().length > 1) {
        const handled = await registry.execute(text, store);
        if (handled) return;
      }
      await submitQuery(store, text, attachments);
    },
    [store, registry],
  );

  const handleCancel = useCallback(() => {
    if (streamingState === StreamingState.Responding) {
      cancelRequest(store);
    } else {
      onExit();
    }
  }, [store, streamingState, onExit]);

  const handleGlobalKey = useCallback(
    (key: Key) => {
      if (key.name === 'tab') {
        process.stdout.write(ansiEscapes.clearTerminal);
        store.setState({ toolCallsExpanded: !store.getState().toolCallsExpanded });
        setRemountKey(k => k + 1);
      }
      if (key.ctrl && key.name === 'l') {
        process.stdout.write(ansiEscapes.clearTerminal);
        setRemountKey(k => k + 1);
      }
      if (key.ctrl && key.name === 'c') {
        if (streamingState === StreamingState.Responding) {
          cancelRequest(store);
        } else if (isIdle) {
          onExit();
        }
      }
    },
    [store, streamingState, isIdle, onExit],
  );

  useKeypress(handleGlobalKey, { isActive: true });

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
          onResolveApproval={(approval) => resolveApproval(store, approval)}
          onResolveAsk={(answers) => resolveAsk(store, answers)}
        />

        {(isIdle || streamingState === StreamingState.Responding) && (
          <InputPrompt
            isActive={isIdle}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            commandRegistry={registry}
          />
        )}

        <Footer streamingState={streamingState} commandMode={false} />
      </Box>
    </ErrorBoundary>
  );
};
