export type Alert = {
  id: string;
  time: number; // ms
  title: string;
  message: string;
  priority: number;
  tags: string[];
};

export type CheckConfig = {
  name: string;
  url: string;
};

export type Settings = {
  server: string;
  topic: string;
  token: string;
  checks: CheckConfig[];
  pushEnabled: boolean;
};

export type CheckState = CheckConfig & {
  status: 'unknown' | 'up' | 'down';
  ms: number | null;
  error: string | null;
  failures: number;
  lastCheckedAt: number | null;
  downSince: number | null;
};

export type Agent = {
  host: string;
  lastSeen: number;
  stale: boolean; // no heartbeat for AGENT_STALE_MS
};

export type PushState =
  | { state: 'off' }
  | { state: 'registering' }
  | { state: 'registered'; token: string }
  | { state: 'error'; error: string };
