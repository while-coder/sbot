import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { MessageItem } from './MessageItem.js';
import { MarkdownText } from './MarkdownText.js';
import type { HistoryItem } from '../types.js';

interface MessageListProps {
  history: HistoryItem[];
  streamingContent: string;
  isInputActive: boolean;
  toolCallsExpanded: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  history,
  streamingContent,
  isInputActive,
  toolCallsExpanded,
}) => {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {history.length === 0 && !streamingContent && (
        <Box paddingX={2} paddingY={1}>
          <Text color={theme.text.muted}>No messages yet. Start typing below.</Text>
        </Box>
      )}
      <Box flexDirection="column" paddingX={2}>
        {history.map((item) => (
          <MessageItem key={item.id} item={item} isInputActive={isInputActive} toolCallsExpanded={toolCallsExpanded} />
        ))}
        {streamingContent && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={theme.prompt.assistantPrefix}>Assistant</Text>
            <Box>
              <MarkdownText>{streamingContent}</MarkdownText>
              <Text color={theme.text.accent}>▊</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
