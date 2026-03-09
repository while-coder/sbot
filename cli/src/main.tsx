import React, { useState, useMemo } from 'react';
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { readLocalConfig, writeLocalConfig, type LocalConfig } from './config/localConfig.js';
import { SbotClient, type SbotSettings } from './api/sbotClient.js';
import { KeypressProvider } from './ui/contexts/KeypressContext.js';
import { SetupWizard } from './ui/components/SetupWizard.js';
import { App } from './ui/App.js';
import { theme } from './ui/colors.js';

const BASE_URL = 'http://127.0.0.1:5500';

// ── Root bootstrap component ──────────────────────────────────────────────────

type BootState =
  | { phase: 'loading' }
  | { phase: 'setup'; settings: SbotSettings }
  | { phase: 'chat'; config: LocalConfig }
  | { phase: 'error'; message: string };

function Boot() {
  const [state, setState] = useState<BootState>({ phase: 'loading' });
  const client = useMemo(() => new SbotClient(BASE_URL), []);

  // Run boot sequence on mount
  React.useEffect(() => {
    void (async () => {
      // 1. Check for existing local config
      const existing = readLocalConfig();
      if (existing) {
        setState({ phase: 'chat', config: existing });
        return;
      }

      // 2. Check if sbot is online
      const online = await client.isOnline();
      if (!online) {
        setState({ phase: 'error', message: `Cannot reach sbot at ${BASE_URL}. Is it running?` });
        return;
      }

      // 3. Fetch settings for wizard
      try {
        const settings = await client.fetchSettings();
        if (Object.keys(settings.agents ?? {}).length === 0) {
          setState({ phase: 'error', message: 'No agents configured in sbot. Add an agent first.' });
          return;
        }
        setState({ phase: 'setup', settings });
      } catch (err) {
        setState({ phase: 'error', message: (err as Error).message });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWizardComplete = (
    agentId: string,
    saverId: string,
    memoryId: string | null,
  ) => {
    const cfg: LocalConfig = { agentId, saverId, memoryId };
    writeLocalConfig(cfg);
    setState({ phase: 'chat', config: cfg });
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

  if (state.phase === 'setup') {
    return (
      <SetupWizard
        settings={state.settings}
        onComplete={handleWizardComplete}
      />
    );
  }

  // phase === 'chat'
  return <App client={client} config={state.config} />;
}

// ── Entry point ───────────────────────────────────────────────────────────────

const { waitUntilExit } = render(
  <KeypressProvider>
    <Boot />
  </KeypressProvider>,
);

waitUntilExit().then(() => process.exit(0)).catch(() => process.exit(1));
