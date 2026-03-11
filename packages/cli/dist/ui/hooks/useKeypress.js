import { useEffect, useRef } from 'react';
import { useKeypressContext } from '../contexts/KeypressContext.js';
export function useKeypress(onKeypress, { isActive }) {
    const { subscribe, unsubscribe } = useKeypressContext();
    const handlerRef = useRef(onKeypress);
    // Always keep ref in sync with latest handler
    useEffect(() => {
        handlerRef.current = onKeypress;
    });
    useEffect(() => {
        if (!isActive)
            return;
        const stable = (key) => handlerRef.current(key);
        subscribe(stable);
        return () => { unsubscribe(stable); };
    }, [isActive, subscribe, unsubscribe]);
}
//# sourceMappingURL=useKeypress.js.map