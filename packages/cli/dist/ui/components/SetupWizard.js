import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
const SelectList = ({ title, items, selectedIndex }) => (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { bold: true, color: theme.text.accent, children: title }), _jsx(Box, { flexDirection: "column", marginTop: 1, children: items.map((item, i) => (_jsxs(Text, { color: i === selectedIndex ? theme.status.info : theme.text.primary, children: [i === selectedIndex ? '▶ ' : '  ', item.name] }, item.id))) })] }));
export const SetupWizard = ({ settings, onComplete }) => {
    const agentItems = Object.entries(settings.agents ?? {}).map(([id, a]) => ({ id, name: a.name ?? id }));
    const saverItems = Object.entries(settings.savers ?? {}).map(([id, s]) => ({ id, name: s.name ?? id }));
    const memoryItems = [
        { id: '', name: '(none)' },
        ...Object.entries(settings.memories ?? {}).map(([id, m]) => ({ id, name: m.name ?? id })),
    ];
    const [step, setStep] = useState('agent');
    const [agentIdx, setAgentIdx] = useState(0);
    const [saverIdx, setSaverIdx] = useState(0);
    const [memoryIdx, setMemoryIdx] = useState(0);
    const handleKeypress = useCallback((key) => {
        const lists = {
            agent: { len: agentItems.length, idx: agentIdx, setIdx: setAgentIdx },
            saver: { len: saverItems.length, idx: saverIdx, setIdx: setSaverIdx },
            memory: { len: memoryItems.length, idx: memoryIdx, setIdx: setMemoryIdx },
        };
        const cur = lists[step];
        if (key.name === 'up') {
            cur.setIdx(Math.max(0, cur.idx - 1));
        }
        else if (key.name === 'down') {
            cur.setIdx(Math.min(cur.len - 1, cur.idx + 1));
        }
        else if (key.name === 'return') {
            if (step === 'agent')
                setStep('saver');
            else if (step === 'saver')
                setStep('memory');
            else {
                const agent = agentItems[agentIdx] ?? { id: '', name: '' };
                const saver = saverItems[saverIdx] ?? { id: '', name: '' };
                const memory = memoryIdx === 0 ? null : (memoryItems[memoryIdx] ?? null);
                onComplete(agent.id, saver.id, memory?.id ?? null, agent.name, saver.name);
            }
        }
    }, [step, agentIdx, saverIdx, memoryIdx, agentItems, saverItems, memoryItems, onComplete]);
    useKeypress(handleKeypress, { isActive: true });
    const steps = {
        agent: { title: 'Step 1/3 — Select Agent', items: agentItems, idx: agentIdx },
        saver: { title: 'Step 2/3 — Select Saver', items: saverItems, idx: saverIdx },
        memory: { title: 'Step 3/3 — Select Memory', items: memoryItems, idx: memoryIdx },
    };
    const cur = steps[step];
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsx(Text, { bold: true, color: theme.text.accent, children: "sbot-cli First Run Setup" }), _jsx(Text, { color: theme.text.secondary, children: "\u2191\u2193 navigate  Enter select" }), _jsx(SelectList, { title: cur.title, items: cur.items, selectedIndex: cur.idx })] }));
};
//# sourceMappingURL=SetupWizard.js.map