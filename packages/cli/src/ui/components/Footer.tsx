import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { StreamingState } from '../types.js';

interface FooterProps {
  streamingState: StreamingState;
}

export const Footer: React.FC<FooterProps> = ({ streamingState }) => (
  <Box borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
    {streamingState === StreamingState.Responding ? (
      <Text color={theme.status.warning}>Ctrl+C cancel</Text>
    ) : (
      <Text color={theme.text.muted}>
        Enter send  Shift+Enter newline  ↑↓ history  Tab fold tool_call  Ctrl+L clear  Ctrl+C exit
      </Text>
    )}
  </Box>
);
