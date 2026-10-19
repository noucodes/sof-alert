import { useEffect, useState } from 'react';

// Current time that re-renders the component every `intervalMs`, so "5m ago"
// labels and staleness checks stay fresh without reading the clock in render.
export function useNow(intervalMs = 30 * 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
