import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log but don't crash
    process.stderr.write(`[sbot-cli] render error: ${error.message}\n${info.componentStack ?? ''}\n`);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color={theme.status.error}>Render error: {this.state.error.message}</Text>
          <Text color={theme.text.muted}>Press any key to continue...</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
