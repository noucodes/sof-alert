import type { Alert } from './types';

// ntfy tags the agents use for styling; anything else is a source name.
const EMOJI_TAGS = new Set(['rotating_light', 'warning', 'repeat', 'red_circle', 'green_circle', 'down', 'up', 'robot', 'test_tube']);

export type Category = 'error' | 'outage' | 'info';
export type Severity = 'critical' | 'error' | 'ok' | 'info';

export function ago(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function duration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function category(alert: Alert): Category {
  if (alert.tags.includes('down') || alert.tags.includes('up')) return 'outage';
  if (alert.tags.some((t) => t === 'rotating_light' || t === 'warning' || t === 'repeat')) return 'error';
  return 'info';
}

export function severity(alert: Alert): Severity {
  if (alert.tags.includes('up')) return 'ok';
  if (alert.priority >= 5) return 'critical';
  if (alert.priority >= 4) return 'error';
  return 'info';
}

export function sources(alert: Alert): string[] {
  return alert.tags.filter((t) => !EMOJI_TAGS.has(t));
}

export function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim()) || '';
}
