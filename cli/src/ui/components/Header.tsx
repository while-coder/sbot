import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';

interface HeaderProps {
  sessionId: string;
  agentName: string;
  saverName: string;
  baseUrl: string;
}

export const Header: React.FC<HeaderProps> = ({ sessionId, agentName, saverName, baseUrl }) => (
  <Box borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
    <Text bold color={theme.text.accent}>sbot-cli</Text>
    <Text color={theme.text.muted}>  │  </Text>
    <Text color={theme.text.secondary}>Session: </Text>
    <Text color={theme.text.primary}>{sessionId}</Text>
    <Text color={theme.text.muted}>  Agent: </Text>
    <Text color={theme.text.primary}>{agentName}</Text>
    <Text color={theme.text.muted}>  Saver: </Text>
    <Text color={theme.text.primary}>{saverName}</Text>
    <Text color={theme.text.muted}>  {baseUrl}</Text>
  </Box>
);
