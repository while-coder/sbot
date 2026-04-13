import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../colors.js';
import { MarkdownText } from './MarkdownText.js';
import { ApprovalPrompt } from './ApprovalPrompt.js';
import { AskPrompt } from './AskPrompt.js';
import { StreamingState, type PendingApproval, type PendingAsk } from '../types.js';

interface PendingZoneProps {
  pendingContent: string;
  streamingState: StreamingState;
  pendingApproval: PendingApproval | null;
  pendingAsk: PendingAsk | null;
  onResolveApproval: (approval: string) => void;
  onResolveAsk: (answers: Record<string, string | string[]>) => void;
}

export const PendingZone: React.FC<PendingZoneProps> = ({
  pendingContent,
  streamingState,
  pendingApproval,
  pendingAsk,
  onResolveApproval,
  onResolveAsk,
}) => {
  return (
    <Box flexDirection="column" paddingX={2}>
      {pendingContent !== '' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.prompt.assistantPrefix}>Assistant</Text>
          <Box>
            <MarkdownText>{pendingContent}</MarkdownText>
            <Text color={theme.text.accent}>▊</Text>
          </Box>
        </Box>
      )}

      {streamingState === StreamingState.Responding && pendingContent === '' && (
        <Box marginBottom={1}>
          <Text color={theme.status.info}><Spinner type="dots" /></Text>
          <Text color={theme.text.secondary}> Thinking...</Text>
        </Box>
      )}

      {streamingState === StreamingState.Approval && pendingApproval && (
        <ApprovalPrompt pending={pendingApproval} onResolve={onResolveApproval} />
      )}

      {streamingState === StreamingState.Asking && pendingAsk && (
        <AskPrompt pending={pendingAsk} onResolve={onResolveAsk} />
      )}
    </Box>
  );
};
