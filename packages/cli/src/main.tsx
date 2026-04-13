#!/usr/bin/env node

// Global error handlers — prevent uncaught errors from killing the CLI
process.on('uncaughtException', (err) => {
  process.stderr.write(`[sbot-cli] uncaught error: ${err.message}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[sbot-cli] unhandled rejection: ${reason}\n`);
});

import React, { useState, useMemo } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { SbotClient, getServerBaseUrl, type SbotSettings, type SessionItem } from './api/sbotClient.js';
import { KeypressProvider } from './ui/contexts/KeypressContext.js';
import { SessionPicker } from './ui/components/SessionPicker.js';
import { CreateSessionWizard } from './ui/components/CreateSessionWizard.js';
import { ChatView } from './ui/components/ChatView.js';
import { theme } from './ui/colors.js';

const BASE_URL = getServerBaseUrl();

// ── Root bootstrap component ──────────────────────────────────────────────────

type BootState =
  | { phase: 'loading' }
  | { phase: 'session-pick'; settings: SbotSettings; sessions: SessionItem[] }
  | { phase: 'create'; settings: SbotSettings }
  | { phase: 'chat'; sessionId: string; agentName: string; saverName: string }
  | { phase: 'error'; message: string };

function Boot() {
  const { exit } = useApp();
  const [state, setState] = useState<BootState>({ phase: 'loading' });
  const client = useMemo(() => new SbotClient(BASE_URL), []);

  // Run boot sequence on mount
  React.useEffect(() => {
    void (async () => {
      // 1. Fetch settings (also serves as online check)
      let settings: SbotSettings;
      try {
        settings = await client.fetchSettings();
      } catch {
        setState({ phase: 'error', message: `Cannot reach sbot at ${BASE_URL}. Is it running?` });
        return;
      }

      if (Object.keys(settings.agents ?? {}).length === 0) {
        setState({ phase: 'error', message: 'No agents configured in sbot. Add an agent first.' });
        return;
      }

      // 2. Fetch sessions for current directory
      let sessions: SessionItem[];
      try {
        sessions = await client.fetchSessions(process.cwd());
      } catch {
        sessions = [];
      }

      // 3. Show session picker
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
      const sessionId = await client.createSession(agentId, saverId, memoryIds, process.cwd());
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
    return (
      <Box padding={1} flexDirection="column">
        <Text color={theme.status.error}>✗ {state.message}</Text>
        <Text color={theme.text.muted}>Run sbot first, then retry.</Text>
      </Box>
    );
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

// ── Entry point ───────────────────────────────────────────────────────────────

const { waitUntilExit } = render(
  <KeypressProvider>
    <Boot />
  </KeypressProvider>,
  { exitOnCtrlC: false },
);

waitUntilExit().then(() => process.exit(0)).catch((err) => {
  process.stderr.write(`[sbot-cli] fatal: ${err?.message ?? err}\n`);
  process.exit(0);
});
