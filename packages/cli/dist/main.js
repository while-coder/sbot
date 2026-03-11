import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useMemo } from 'react';
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { readLocalConfig, writeLocalConfig } from './config/localConfig.js';
import { SbotClient } from './api/sbotClient.js';
import { KeypressProvider } from './ui/contexts/KeypressContext.js';
import { SetupWizard } from './ui/components/SetupWizard.js';
import { App } from './ui/App.js';
import { theme } from './ui/colors.js';
const BASE_URL = 'http://127.0.0.1:5500';
function Boot() {
    const [state, setState] = useState({ phase: 'loading' });
    const client = useMemo(() => new SbotClient(BASE_URL), []);
    // Run boot sequence on mount
    React.useEffect(() => {
        void (async () => {
            // 1. Fetch settings (also serves as online check)
            let settings;
            try {
                settings = await client.fetchSettings();
            }
            catch {
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
    const handleWizardComplete = (agentId, saverId, memoryId, agentName, saverName) => {
        const cfg = { agentId, saverId, memoryId };
        writeLocalConfig(cfg);
        setState({ phase: 'chat', config: cfg, agentName, saverName });
    };
    if (state.phase === 'loading') {
        return (_jsxs(Box, { padding: 1, children: [_jsx(Text, { color: theme.status.info, children: _jsx(Spinner, { type: "dots" }) }), _jsx(Text, { color: theme.text.secondary, children: " Connecting to sbot..." })] }));
    }
    if (state.phase === 'error') {
        return (_jsxs(Box, { padding: 1, flexDirection: "column", children: [_jsxs(Text, { color: theme.status.error, children: ["\u2717 ", state.message] }), _jsx(Text, { color: theme.text.muted, children: "Run sbot first, then retry." })] }));
    }
    if (state.phase === 'setup') {
        return (_jsx(SetupWizard, { settings: state.settings, onComplete: handleWizardComplete }));
    }
    // phase === 'chat'
    return _jsx(App, { client: client, config: state.config, agentName: state.agentName, saverName: state.saverName });
}
// ── Entry point ───────────────────────────────────────────────────────────────
const { waitUntilExit } = render(_jsx(KeypressProvider, { children: _jsx(Boot, {}) }));
waitUntilExit().then(() => process.exit(0)).catch(() => process.exit(1));
//# sourceMappingURL=main.js.map