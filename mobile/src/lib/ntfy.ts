import type { Settings } from './types';

export type NtfyMessage = {
  id: string;
  time: number;
  event: string;
  topic: string;
  title?: string;
  message?: string;
  priority?: number;
  tags?: string[];
};

function base(settings: Settings) {
  return settings.server.replace(/\/+$/, '');
}

function headers(settings: Settings): Record<string, string> {
  return settings.token ? { Authorization: `Bearer ${settings.token}` } : {};
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Fetches everything ntfy has cached since `since` (a message id or a
// duration like "24h") for the alert + heartbeat topics.
export async function poll(settings: Settings, since: string): Promise<NtfyMessage[]> {
  const topics = [settings.topic, `${settings.topic}-heartbeat`].map(encodeURIComponent).join(',');
  const url = `${base(settings)}/${topics}/json?poll=1&since=${encodeURIComponent(since)}`;
  const text = await withTimeout(20000, async (signal) => {
    const res = await fetch(url, { headers: headers(settings), signal });
    if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
    return res.text();
  });
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as NtfyMessage)
    .filter((m) => m.event === 'message');
}

export async function publishRaw(settings: Settings, topic: string, body: string): Promise<void> {
  await withTimeout(15000, async (signal) => {
    const res = await fetch(`${base(settings)}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { ...headers(settings), Priority: '1' },
      body,
      signal,
    });
    if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  });
}

export async function checkUrl(url: string): Promise<{ ok: true; ms: number } | { ok: false; ms: number | null; error: string }> {
  const started = Date.now();
  try {
    const res = await withTimeout(10000, (signal) =>
      fetch(url, { headers: { 'ngrok-skip-browser-warning': '1' }, signal }),
    );
    const ms = Date.now() - started;
    if (res.status !== 200) return { ok: false, ms, error: `HTTP ${res.status}` };
    return { ok: true, ms };
  } catch (err) {
    const e = err as Error;
    return { ok: false, ms: null, error: e.name === 'AbortError' ? 'timed out' : e.message || 'network error' };
  }
}
