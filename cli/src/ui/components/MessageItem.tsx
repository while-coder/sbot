import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { ToolCallItem } from './ToolCallItem.js';
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
          <Text color={theme.text.primary}>{item.content}</Text>
        </Box>
      );

    case 'tool_call':
      return (
        <Box marginBottom={1}>
          <ToolCallItem name={item.name} args={item.args} isInputActive={isInputActive} />
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
