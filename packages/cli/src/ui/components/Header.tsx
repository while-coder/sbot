import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';

interface HeaderProps {
  sessionName: string;
  agentName: string;
  saverName: string;
}

export const Header: React.FC<HeaderProps> = ({
  sessionName,
  agentName,
  saverName,
}) => (
  <Box
    borderStyle="single"
    borderColor={theme.text.muted}
    paddingX={1}
    flexDirection="column"
  >
    <Text wrap="truncate-end">
      <Text bold color={theme.text.accent}>sbot-cli</Text>
      <Text color={theme.text.muted}>  ·  </Text>
      <Text bold color={theme.text.primary}>
        {sessionName || '未命名会话'}
      </Text>
    </Text>
    <Text wrap="truncate-end">
      <Text color={theme.text.muted}>Agent: </Text>
      <Text color={theme.text.primary}>{agentName || '未设置'}</Text>
      <Text color={theme.text.muted}>  ·  Saver: </Text>
      <Text color={theme.text.primary}>{saverName || '未设置'}</Text>
    </Text>
  </Box>
);
