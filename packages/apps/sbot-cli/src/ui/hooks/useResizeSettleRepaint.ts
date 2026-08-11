import { useEffect, useRef } from 'react';

const RESIZE_REPAINT_SETTLE_MS = 200;

export function useResizeSettleRepaint(
  terminalWidth: number,
  repaint: () => void,
): void {
  const settledWidthRef = useRef(terminalWidth);

  useEffect(() => {
    if (settledWidthRef.current === terminalWidth) return;

    const timer = setTimeout(() => {
      settledWidthRef.current = terminalWidth;
      repaint();
    }, RESIZE_REPAINT_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [terminalWidth, repaint]);
}
