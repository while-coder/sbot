import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';

interface HeaderProps {
  agentName: string;
  saverName: string;
}

export const Header: React.FC<HeaderProps> = ({ agentName, saverName }) => (
  <Box borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
    <Text bold color={theme.text.accent}>sbot-cli</Text>
    <Text color={theme.text.muted}>  │  </Text>
    <Text color={theme.text.muted}>  Agent: </Text>
    <Text color={theme.text.primary}>{agentName}</Text>
    <Text color={theme.text.muted}>  Saver: </Text>
    <Text color={theme.text.primary}>{saverName}</Text>
  </Box>
);
