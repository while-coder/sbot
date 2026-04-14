import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { ToolCallItem } from './ToolCallItem.js';
import { MarkdownText } from './MarkdownText.js';
import type { HistoryItem as HistoryItemType } from '../types.js';

interface HistoryItemProps {
  item: HistoryItemType;
  toolCallsExpanded: boolean;
}

export const HistoryItem: React.FC<HistoryItemProps> = ({ item, toolCallsExpanded }) => {
  switch (item.type) {
    case 'user':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.prompt.userPrefix}>You</Text>
          {item.content && <Text color={theme.text.primary}>{item.content}</Text>}
          {item.attachments?.map((name, i) => (
            <Text key={i} color={theme.status.info}>  [attached] {name}</Text>
          ))}
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
          <ToolCallItem name={item.name} args={item.args} result={item.result} expanded={toolCallsExpanded} />
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
