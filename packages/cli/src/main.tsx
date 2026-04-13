#!/usr/bin/env node

// Global error handlers — prevent uncaught errors from killing the CLI
process.on('uncaughtException', (err) => {
  process.stderr.write(`[sbot-cli] uncaught error: ${err.message}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[sbot-cli] unhandled rejection: ${reason}\n`);
});

import React, { useState, useMemo, useCallback } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { SbotClient, type SbotSettings, type SessionItem } from './api/sbotClient.js';
import { KeypressProvider } from './ui/contexts/KeypressContext.js';
import { useKeypress, type Key } from './ui/hooks/useKeypress.js';
import { ConnectionWizard, type ConnectionTarget } from './ui/components/ConnectionWizard.js';
import { SessionPicker } from './ui/components/SessionPicker.js';
import { CreateSessionWizard } from './ui/components/CreateSessionWizard.js';
import { ChatView } from './ui/components/ChatView.js';
import { theme } from './ui/colors.js';

// ── Boot component (now receives baseUrl + workPath) ────────────────────────

type BootState =
  | { phase: 'loading' }
  | { phase: 'session-pick'; settings: SbotSettings; sessions: SessionItem[] }
  | { phase: 'create'; settings: SbotSettings }
  | { phase: 'chat'; sessionId: string; agentName: string; saverName: string }
  | { phase: 'error'; message: string };

interface BootProps {
  baseUrl: string;
  workPath: string;
  onBack: () => void;
}

function Boot({ baseUrl, workPath, onBack }: BootProps) {
  const { exit } = useApp();
  const [state, setState] = useState<BootState>({ phase: 'loading' });
  const client = useMemo(() => new SbotClient(baseUrl), [baseUrl]);

  React.useEffect(() => {
    void (async () => {
      let settings: SbotSettings;
      try {
        settings = await client.fetchSettings();
      } catch {
        setState({ phase: 'error', message: `Cannot reach sbot at ${baseUrl}. Is it running?` });
        return;
      }

      if (Object.keys(settings.agents ?? {}).length === 0) {
        setState({ phase: 'error', message: 'No agents configured in sbot. Add an agent first.' });
        return;
      }

      let sessions: SessionItem[];
      try {
        sessions = await client.fetchSessions(workPath);
      } catch {
        sessions = [];
      }

      setState({ phase: 'session-pick', settings, sessions });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSessionSelect = (sessionId: string, agentName: string, saverName: string) => {
    setState({ phase: 'chat', sessionId, agentName, saverName });
  };

  const handleCreateNew = () => {
    if (state.phase === 'session-pick') {
      setState({ phase: 'create', settings: state.settings });
    }
  };

  const handleWizardComplete = async (
    agentId: string,
    saverId: string,
    memoryIds: string[],
    agentName: string,
    saverName: string,
  ) => {
    try {
      const sessionId = await client.createSession(agentId, saverId, memoryIds, workPath);
      setState({ phase: 'chat', sessionId, agentName, saverName });
    } catch (e: any) {
      setState({ phase: 'error', message: `Failed to create session: ${e.message}` });
    }
  };

  if (state.phase === 'loading') {
    return (
      <Box padding={1}>
        <Text color={theme.status.info}><Spinner type="dots" /></Text>
        <Text color={theme.text.secondary}> Connecting to sbot...</Text>
      </Box>
    );
  }

  if (state.phase === 'error') {
    return <BootError message={state.message} onBack={onBack} />;
  }

  if (state.phase === 'session-pick') {
    const agentNames: Record<string, string> = {};
    for (const [id, a] of Object.entries(state.settings.agents ?? {})) {
      agentNames[id] = a.name ?? id;
    }
    return (
      <SessionPicker
        sessions={state.sessions}
        agentNames={agentNames}
        onSelect={handleSessionSelect}
        onCreateNew={handleCreateNew}
      />
    );
  }

  if (state.phase === 'create') {
    return (
      <CreateSessionWizard
        settings={state.settings}
        onComplete={handleWizardComplete}
      />
    );
  }

  // phase === 'chat'
  return <ChatView client={client} sessionId={state.sessionId} agentName={state.agentName} saverName={state.saverName} onExit={exit} />;
}

// ── BootError: show error + Enter to go back ────────────────────────────────

function BootError({ message, onBack }: { message: string; onBack: () => void }) {
  const handleKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'return') onBack();
    },
    [onBack],
  );
  useKeypress(handleKeypress, { isActive: true });

  return (
    <Box padding={1} flexDirection="column">
      <Text color={theme.status.error}>✗ {message}</Text>
      <Text color={theme.text.muted}>Press Enter to go back.</Text>
    </Box>
  );
}

// ── App: ConnectionWizard → Boot ────────────────────────────────────────────

function App() {
  const [target, setTarget] = useState<ConnectionTarget | null>(null);
  const handleBack = useCallback(() => setTarget(null), []);

  if (!target) {
    return <ConnectionWizard onReady={setTarget} />;
  }

  return <Boot baseUrl={target.baseUrl} workPath={target.workPath} onBack={handleBack} />;
}

// ── Entry point ─────────────────────────────────────────────────────────────

const { waitUntilExit } = render(
  <KeypressProvider>
    <App />
  </KeypressProvider>,
  { exitOnCtrlC: false },
);

waitUntilExit().then(() => process.exit(0)).catch((err) => {
  process.stderr.write(`[sbot-cli] fatal: ${err?.message ?? err}\n`);
  process.exit(0);
});
