const net = require('net');
const { EventEmitter } = require('events');

async function httpCheck(check) {
  const started = Date.now();
  const res = await fetch(check.url, {
    headers: { 'ngrok-skip-browser-warning': '1', ...(check.headers || {}) },
    signal: AbortSignal.timeout(check.timeoutMs || 10000),
    redirect: 'follow',
  });
  const ms = Date.now() - started;
  const expect = check.expectStatus || 200;
  if (res.status !== expect) {
    await res.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`HTTP ${res.status} (expected ${expect})`), { ms });
  }
  if (check.expectBody) {
    const body = await res.text();
    if (!body.includes(check.expectBody)) {
      throw Object.assign(new Error(`response missing "${check.expectBody}"`), { ms });
    }
  } else {
    await res.body?.cancel().catch(() => {});
  }
  return ms;
}

function tcpCheck(check) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.connect({ host: check.host, port: check.port });
    socket.setTimeout(check.timeoutMs || 10000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(Date.now() - started);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`TCP ${check.host}:${check.port} timed out`));
    });
    socket.once('error', (err) => reject(new Error(`TCP ${check.host}:${check.port}: ${err.code || err.message}`)));
  });
}

async function runCheck(check) {
  try {
    const ms = check.type === 'tcp' ? await tcpCheck(check) : await httpCheck(check);
    return { ok: true, ms };
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code || err.message;
    return { ok: false, ms: err.ms ?? null, error: message };
  }
}

function describe(check) {
  return check.type === 'tcp' ? `${check.host}:${check.port}` : check.url;
}

// Polls every check on an interval and tracks up/down state. A check is only
// declared down after `failThreshold` consecutive failures so a single blip
// doesn't page anyone.
//
// Events: 'down' (state), 'up' (state, downtimeMs), 'reminder' (state),
// 'update' (states[]).
class CheckMonitor extends EventEmitter {
  constructor(checks, { intervalSec = 60, failThreshold = 2, remindEveryMin = 30 } = {}) {
    super();
    this.intervalMs = intervalSec * 1000;
    this.failThreshold = failThreshold;
    this.remindMs = remindEveryMin * 60 * 1000;
    this.states = checks.map((check) => ({
      name: check.name,
      target: describe(check),
      check,
      status: 'unknown',
      failures: 0,
      downSince: null,
      lastReminder: null,
      lastCheckedAt: null,
      ms: null,
      error: null,
    }));
  }

  start() {
    this.tick();
    this.interval = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.interval);
  }

  snapshot() {
    return this.states.map(({ check, ...rest }) => rest);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all(this.states.map((s) => this.evaluate(s)));
      this.emit('update', this.snapshot());
    } finally {
      this.running = false;
    }
  }

  async evaluate(state) {
    const result = await runCheck(state.check);
    const now = Date.now();
    state.lastCheckedAt = now;
    state.ms = result.ms;
    state.error = result.ok ? null : result.error;

    if (result.ok) {
      const wasDown = state.status === 'down';
      const downtime = wasDown ? now - state.downSince : 0;
      state.status = 'up';
      state.failures = 0;
      state.downSince = null;
      state.lastReminder = null;
      if (wasDown) this.emit('up', this.publicState(state), downtime);
      return;
    }

    state.failures++;
    if (state.status !== 'down' && state.failures >= this.failThreshold) {
      state.status = 'down';
      state.downSince = now;
      state.lastReminder = now;
      this.emit('down', this.publicState(state));
    } else if (state.status === 'down' && now - state.lastReminder >= this.remindMs) {
      state.lastReminder = now;
      this.emit('reminder', this.publicState(state));
    }
  }

  publicState(state) {
    const { check, ...rest } = state;
    return { ...rest };
  }
}

module.exports = { CheckMonitor, runCheck };
