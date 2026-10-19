import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { checkUrl, poll, publishRaw } from './ntfy';
import { deviceName, getPushToken, sendTestPush, setupChannels } from './push';
import type { Agent, Alert, CheckState, PushState, Settings } from './types';
import { useNow } from './useNow';

const SETTINGS_KEY = 'sof-alert/settings';
const DATA_KEY = 'sof-alert/data';
const MAX_ALERTS = 500;
const SYNC_MS = 20 * 1000;
const CHECK_MS = 60 * 1000;
const FAIL_THRESHOLD = 2;
export const AGENT_STALE_MS = 12 * 60 * 1000;

export const defaultSettings: Settings = {
  server: 'https://ntfy.sh',
  topic: '',
  token: '',
  checks: [],
  pushEnabled: true,
};

type Data = {
  alerts: Alert[];
  since: string | null;
  agents: Record<string, number>;
  lastReadAt: number;
};

const emptyData: Data = { alerts: [], since: null, agents: {}, lastReadAt: 0 };

type Store = {
  ready: boolean;
  settings: Settings;
  alerts: Alert[];
  agents: Agent[];
  checks: CheckState[];
  unread: number;
  syncing: boolean;
  lastSyncAt: number | null;
  syncError: string | null;
  push: PushState;
  refresh: () => Promise<void>;
  runChecks: () => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  clearAlerts: () => Promise<void>;
  markRead: () => void;
  registerPush: () => Promise<void>;
  sendTest: () => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

function freshChecks(settings: Settings, previous: CheckState[] = []): CheckState[] {
  return settings.checks.map((c) => {
    const prev = previous.find((p) => p.name === c.name && p.url === c.url);
    return prev ?? { ...c, status: 'unknown', ms: null, error: null, failures: 0, lastCheckedAt: null, downSince: null };
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [data, setData] = useState<Data>(emptyData);
  const [checks, setChecks] = useState<CheckState[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>({ state: 'off' });
  const [active, setActive] = useState(AppState.currentState === 'active');

  // Refs give the interval callbacks the latest values without re-subscribing.
  // They're written wherever the matching state is set.
  const settingsRef = useRef(settings);
  const dataRef = useRef(data);
  const checksRef = useRef(checks);
  const syncingRef = useRef(false);

  const updateChecks = useCallback((next: CheckState[]) => {
    checksRef.current = next;
    setChecks(next);
  }, []);

  const updateData = useCallback((fn: (d: Data) => Data) => {
    const next = fn(dataRef.current);
    dataRef.current = next;
    setData(next);
    AsyncStorage.setItem(DATA_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // ---- load ----
  useEffect(() => {
    (async () => {
      try {
        const [s, d] = await Promise.all([AsyncStorage.getItem(SETTINGS_KEY), AsyncStorage.getItem(DATA_KEY)]);
        const loaded = s ? { ...defaultSettings, ...JSON.parse(s) } : defaultSettings;
        settingsRef.current = loaded;
        setSettings(loaded);
        updateChecks(freshChecks(loaded));
        if (d) {
          const parsed = { ...emptyData, ...JSON.parse(d) };
          dataRef.current = parsed;
          setData(parsed);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [updateChecks]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Clock for the unread/stale calculations below (not read during render).
  const now = useNow(60 * 1000);

  // ---- sync from ntfy ----
  const refresh = useCallback(async () => {
    const s = settingsRef.current;
    if (!s.topic || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const messages = await poll(s, dataRef.current.since ?? '24h');
      if (messages.length) {
        updateData((d) => {
          const known = new Set(d.alerts.map((a) => a.id));
          const agents = { ...d.agents };
          const added: Alert[] = [];
          for (const m of messages) {
            if (m.topic.endsWith('-heartbeat')) {
              agents[m.title || 'unknown'] = m.time * 1000;
            } else if (!known.has(m.id)) {
              added.push({
                id: m.id,
                time: m.time * 1000,
                title: m.title || 'Alert',
                message: m.message || '',
                priority: m.priority || 3,
                tags: m.tags || [],
              });
            }
          }
          const alerts = [...added, ...d.alerts].sort((a, b) => b.time - a.time).slice(0, MAX_ALERTS);
          return { ...d, alerts, agents, since: messages[messages.length - 1].id };
        });
      }
      setSyncError(null);
      setLastSyncAt(Date.now());
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [updateData]);

  // ---- health checks (only while the app is open; agents cover the rest) ----
  const runChecks = useCallback(async () => {
    const current = freshChecks(settingsRef.current, checksRef.current);
    const results = await Promise.all(current.map((c) => checkUrl(c.url)));
    const now = Date.now();
    updateChecks(
      current.map((c, i) => {
        const r = results[i];
        if (r.ok) return { ...c, status: 'up', ms: r.ms, error: null, failures: 0, lastCheckedAt: now, downSince: null };
        const failures = c.failures + 1;
        const down = c.status === 'down' || failures >= FAIL_THRESHOLD;
        return {
          ...c,
          status: down ? 'down' : c.status,
          ms: r.ms,
          error: r.error,
          failures,
          lastCheckedAt: now,
          downSince: down ? (c.downSince ?? now) : null,
        };
      }),
    );
  }, [updateChecks]);

  // Poll while the app is in the foreground; restart when settings change.
  useEffect(() => {
    if (!ready || !active) return;
    const first = setTimeout(() => {
      refresh();
      runChecks();
    }, 0);
    const sync = setInterval(refresh, SYNC_MS);
    const check = setInterval(runChecks, CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(sync);
      clearInterval(check);
    };
  }, [ready, active, settings, refresh, runChecks]);

  // ---- push registration ----
  const registerPush = useCallback(async () => {
    const s = settingsRef.current;
    if (!s.pushEnabled || !s.topic) {
      setPush({ state: 'off' });
      return;
    }
    setPush({ state: 'registering' });
    try {
      await setupChannels();
      const token = await getPushToken();
      // Agents follow this topic and keep the token until Expo reports it dead.
      await publishRaw(s, `${s.topic}-devices`, JSON.stringify({ token, name: deviceName() }));
      setPush({ state: 'registered', token });
    } catch (err) {
      setPush({ state: 'error', error: (err as Error).message });
    }
  }, []);

  // Re-register on launch and whenever the topic/server/toggle changes. The
  // timeout also coalesces quick successive changes.
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(registerPush, 0);
    return () => clearTimeout(id);
  }, [ready, settings.topic, settings.server, settings.pushEnabled, registerPush]);

  const sendTest = useCallback(async () => {
    if (push.state !== 'registered') throw new Error('Push is not registered yet.');
    await sendTestPush(push.token);
  }, [push]);

  // ---- settings / data ----
  const saveSettings = useCallback(
    async (next: Settings) => {
      const prev = settingsRef.current;
      const normalised = { ...next, server: next.server.trim() || defaultSettings.server, topic: next.topic.trim() };
      // Stop pushes to this phone when push is turned off or the topic changes.
      if (push.state === 'registered' && prev.topic && (!normalised.pushEnabled || prev.topic !== normalised.topic)) {
        publishRaw(prev, `${prev.topic}-devices`, JSON.stringify({ token: push.token, action: 'unregister' })).catch(() => {});
      }
      if (prev.topic !== normalised.topic || prev.server !== normalised.server) {
        updateData(() => ({ ...emptyData }));
      }
      settingsRef.current = normalised;
      setSettings(normalised);
      updateChecks(freshChecks(normalised, checksRef.current));
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(normalised));
    },
    [push, updateData, updateChecks],
  );

  const clearAlerts = useCallback(async () => {
    updateData((d) => ({ ...d, alerts: [], lastReadAt: Date.now() }));
  }, [updateData]);

  const markRead = useCallback(() => {
    if (dataRef.current.alerts[0] && dataRef.current.alerts[0].time > dataRef.current.lastReadAt) {
      updateData((d) => ({ ...d, lastReadAt: Date.now() }));
    }
  }, [updateData]);

  const value = useMemo<Store>(
    () => ({
      ready,
      settings,
      alerts: data.alerts,
      agents: Object.entries(data.agents)
        .map(([host, lastSeen]) => ({ host, lastSeen, stale: now - lastSeen > AGENT_STALE_MS }))
        .sort((a, b) => a.host.localeCompare(b.host)),
      checks,
      unread: data.alerts.filter((a) => a.time > data.lastReadAt && a.priority >= 3).length,
      syncing,
      lastSyncAt,
      syncError,
      push,
      refresh,
      runChecks,
      saveSettings,
      clearAlerts,
      markRead,
      registerPush,
      sendTest,
    }),
    [ready, settings, data, now, checks, syncing, lastSyncAt, syncError, push, refresh, runChecks, saveSettings, clearAlerts, markRead, registerPush, sendTest],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
