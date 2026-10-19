const { EventEmitter } = require('events');

const STALL_MS = 120 * 1000; // ntfy sends a keepalive every ~45s

// Streams messages from one or more ntfy topics and reconnects forever,
// resuming from the last message id so nothing is missed across drops.
//
// Events: 'message' (msg), 'connected', 'disconnected' (error)
class NtfySubscriber extends EventEmitter {
  constructor({ server, token }, topics, since) {
    super();
    this.server = server.replace(/\/+$/, '');
    this.token = token;
    this.topics = topics;
    this.since = since || '24h';
    this.stopped = false;
    this.backoff = 2000;
  }

  start() {
    this.loop();
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    clearTimeout(this.retryTimer);
  }

  async loop() {
    while (!this.stopped) {
      try {
        await this.connect();
        if (!this.stopped) this.emit('disconnected', new Error('stream ended'));
      } catch (err) {
        if (this.stopped) return;
        this.emit('disconnected', err);
      }
      await new Promise((r) => (this.retryTimer = setTimeout(r, this.backoff)));
      this.backoff = Math.min(this.backoff * 2, 60000);
    }
  }

  async connect() {
    this.controller = new AbortController();
    const url = `${this.server}/${this.topics.map(encodeURIComponent).join(',')}/json?since=${encodeURIComponent(this.since)}`;
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};
    const res = await fetch(url, { headers, signal: this.controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let watchdog;
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => this.controller.abort(), STALL_MS);
    };
    resetWatchdog();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        resetWatchdog();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) this.handleLine(line);
      }
    } finally {
      clearTimeout(watchdog);
    }
  }

  handleLine(line) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.event === 'open') {
      this.backoff = 2000;
      this.emit('connected');
    } else if (event.event === 'message') {
      this.since = event.id;
      this.emit('message', event);
    }
  }
}

module.exports = { NtfySubscriber };
