import { jsx as _jsx } from "react/jsx-runtime";
import { useStdin } from 'ink';
import { createContext, useCallback, useContext, useEffect, useRef, } from 'react';
import readline from 'node:readline';
const KeypressContext = createContext(undefined);
export function useKeypressContext() {
    const context = useContext(KeypressContext);
    if (!context) {
        throw new Error('useKeypressContext must be used within a KeypressProvider');
    }
    return context;
}
export function KeypressProvider({ children }) {
    const { stdin, setRawMode } = useStdin();
    const subscribers = useRef(new Set()).current;
    const subscribe = useCallback((handler) => { subscribers.add(handler); }, [subscribers]);
    const unsubscribe = useCallback((handler) => { subscribers.delete(handler); }, [subscribers]);
    useEffect(() => {
        const wasRaw = stdin.isRaw;
        if (!wasRaw)
            setRawMode(true);
        const handleKeypress = (_, key) => {
            if (!key)
                return;
            for (const handler of subscribers)
                handler(key);
        };
        const rl = readline.createInterface({ input: stdin, escapeCodeTimeout: 0 });
        readline.emitKeypressEvents(stdin, rl);
        stdin.on('keypress', handleKeypress);
        return () => {
            stdin.removeListener('keypress', handleKeypress);
            rl.close();
            if (!wasRaw)
                setRawMode(false);
        };
    }, [stdin, setRawMode, subscribers]);
    return (_jsx(KeypressContext.Provider, { value: { subscribe, unsubscribe }, children: children }));
}
//# sourceMappingURL=KeypressContext.js.map