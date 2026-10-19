const fs = require('fs');
const { NtfySubscriber } = require('./ntfy-subscriber');
const { truncate, log } = require('./util');

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;
const MAX_BODY = 900; // Expo/FCM payload limit is 4 KiB including data
const BATCH = 100;

// Android notification channels created by the mobile app.
function channelFor(priority) {
  if (priority >= 5) return 'outages';
  if (priority >= 4) return 'errors';
  return 'info';
}

// Sends alerts to the SOF Alert Android app through the Expo push service.
//
// Phones register by publishing {"token": "ExponentPushToken[...]"} to the
// `<topic>-devices` ntfy topic every time the app opens. The registry follows
// that topic and persists tokens to `devicesFile`, so registrations survive
// agent restarts and ntfy's message cache expiring.
class ExpoPush {
  constructor(ntfy, { devicesFile, accessToken, minPriority = 3 } = {}) {
    this.ntfy = ntfy;
    this.devicesFile = devicesFile;
    this.accessToken = accessToken;
    this.minPriority = minPriority;
    this.devices = new Map(); // token -> { name, registeredAt }
    this.since = 'all';
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.devicesFile, 'utf8'));
      for (const d of saved.devices || []) this.devices.set(d.token, d);
      if (saved.since) this.since = saved.since;
    } catch {
      // no devices yet
    }
  }

  save() {
    if (!this.devicesFile) return;
    const data = { since: this.since, devices: [...this.devices.values()] };
    fs.writeFile(this.devicesFile, JSON.stringify(data, null, 2), (err) => {
      if (err) log(`[push] cannot save ${this.devicesFile}: ${err.message}`);
    });
  }

  get topic() {
    return `${this.ntfy.topic}-devices`;
  }

  // One-off catch-up of registrations — used before sending a test.
  async sync() {
    const server = this.ntfy.server.replace(/\/+$/, '');
    const headers = this.ntfy.token ? { Authorization: `Bearer ${this.ntfy.token}` } : {};
    const res = await fetch(`${server}/${encodeURIComponent(this.topic)}/json?poll=1&since=${encodeURIComponent(this.since)}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`device sync failed: HTTP ${res.status}`);
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.event === 'message') this.handleRegistration(event);
    }
    this.save();
  }

  start() {
    this.subscriber = new NtfySubscriber(this.ntfy, [this.topic], this.since);
    this.subscriber.on('message', (event) => {
      this.handleRegistration(event);
      this.save();
    });
    this.subscriber.on('disconnected', (err) => log(`[push] device topic disconnected: ${err.message}`));
    this.subscriber.start();
    log(`[push] ${this.devices.size} registered device(s); listening on ${this.topic}`);
  }

  stop() {
    this.subscriber?.stop();
  }

  handleRegistration(event) {
    this.since = event.id;
    let msg;
    try {
      msg = JSON.parse(event.message);
    } catch {
      return;
    }
    if (!TOKEN_RE.test(msg.token || '')) return;
    if (msg.action === 'unregister') {
      if (this.devices.delete(msg.token)) log(`[push] device unregistered: ${msg.name || msg.token}`);
      return;
    }
    if (!this.devices.has(msg.token)) log(`[push] device registered: ${msg.name || msg.token}`);
    this.devices.set(msg.token, { token: msg.token, name: msg.name || 'phone', registeredAt: event.time * 1000 });
  }

  async send({ title, message, priority = 3 }, ntfyId) {
    if (priority < this.minPriority || !this.devices.size) return;
    const tokens = [...this.devices.keys()];
    const base = {
      title,
      body: truncate(message || title, MAX_BODY),
      data: { id: ntfyId || null, priority },
      channelId: channelFor(priority),
      priority: priority >= 4 ? 'high' : 'default',
      sound: 'default',
      // a "down" alert from hours ago is noise — let undelivered ones lapse
      ttl: priority >= 5 ? 6 * 3600 : 24 * 3600,
    };

    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      try {
        const res = await fetch(PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch.map((to) => ({ ...base, to }))),
          signal: AbortSignal.timeout(15000),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          log(`[push] send failed: HTTP ${res.status} ${JSON.stringify(body.errors || body)}`);
          continue;
        }
        (body.data || []).forEach((ticket, idx) => {
          if (ticket.status !== 'error') return;
          log(`[push] ${batch[idx]}: ${ticket.details?.error || ticket.message}`);
          if (ticket.details?.error === 'DeviceNotRegistered') {
            this.devices.delete(batch[idx]);
            this.save();
          }
        });
      } catch (err) {
        log(`[push] send error: ${err.message}`);
      }
    }
  }
}

module.exports = { ExpoPush };
