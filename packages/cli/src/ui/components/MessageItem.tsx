import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { ToolCallItem } from './ToolCallItem.js';
import { MarkdownText } from './MarkdownText.js';
import type { HistoryItem } from '../types.js';

interface MessageItemProps {
  item: HistoryItem;
  isInputActive: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({ item, isInputActive }) => {
  switch (item.type) {
    case 'user':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.prompt.userPrefix}>You</Text>
          <Text color={theme.text.primary}>{item.content}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.prompt.assistantPrefix}>Assistant</Text>
          <MarkdownText>{item.content}</MarkdownText>
        </Box>
      );

    case 'toolCall':
      return (
        <Box marginBottom={1}>
          <ToolCallItem name={item.name} args={item.args} result={item.result} isInputActive={isInputActive} />
        </Box>
      );

    case 'ask':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.status.info}>
            {item.title ? `[ask] ${item.title}` : '[ask]'}
          </Text>
          {Object.entries(item.answers).map(([label, val]) => (
            <Text key={label} color={theme.text.primary}>
              {'  '}{label}: {Array.isArray(val) ? val.join(', ') : val}
            </Text>
          ))}
        </Box>
      );

    case 'error':
      return (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>Error: {item.message}</Text>
        </Box>
      );

    default:
      return null;
  }
};
