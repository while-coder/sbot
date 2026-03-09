import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';

interface HeaderProps {
  agentId: string;
  saverId: string;
}

export const Header: React.FC<HeaderProps> = ({ agentId, saverId }) => (
  <Box borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
    <Text bold color={theme.text.accent}>sbot-cli</Text>
    <Text color={theme.text.muted}>  │  </Text>
    <Text color={theme.text.muted}>  Agent: </Text>
    <Text color={theme.text.primary}>{agentId}</Text>
    <Text color={theme.text.muted}>  Saver: </Text>
    <Text color={theme.text.primary}>{saverId}</Text>
  </Box>
);
