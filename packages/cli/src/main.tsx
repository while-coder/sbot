import React, { useState, useMemo } from 'react';
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { readLocalConfig, writeLocalConfig, type LocalConfig } from './config/localConfig.js';
import { SbotClient, getServerBaseUrl, type SbotSettings } from './api/sbotClient.js';
import { KeypressProvider } from './ui/contexts/KeypressContext.js';
import { SetupWizard } from './ui/components/SetupWizard.js';
import { App } from './ui/App.js';
import { theme } from './ui/colors.js';

const BASE_URL = getServerBaseUrl();

// ── Root bootstrap component ──────────────────────────────────────────────────

type BootState =
  | { phase: 'loading' }
  | { phase: 'setup'; settings: SbotSettings }
  | { phase: 'chat'; config: LocalConfig; agentName: string; saverName: string }
  | { phase: 'error'; message: string };

function Boot() {
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

      // 2. Use existing local config if present
      const existing = readLocalConfig();
      if (existing) {
        const agentName = settings.agents?.[existing.agentId]?.name ?? existing.agentId;
        const saverName = settings.savers?.[existing.saverId]?.name ?? existing.saverId;
        setState({ phase: 'chat', config: existing, agentName, saverName });
        return;
      }

      // 3. Show setup wizard
      setState({ phase: 'setup', settings });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWizardComplete = (
    agentId: string,
    saverId: string,
    memoryId: string | null,
    agentName: string,
    saverName: string,
  ) => {
    const cfg: LocalConfig = { agentId, saverId, memoryId };
    writeLocalConfig(cfg);
    setState({ phase: 'chat', config: cfg, agentName, saverName });
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
  return <App client={client} config={state.config} agentName={state.agentName} saverName={state.saverName} />;
}

// ── Entry point ───────────────────────────────────────────────────────────────

const { waitUntilExit } = render(
  <KeypressProvider>
    <Boot />
  </KeypressProvider>,
);

waitUntilExit().then(() => process.exit(0)).catch(() => process.exit(1));
