const { fingerprint, log } = require('./util');

// Turns log error entries into notifications without flooding the phone:
//  - the same error (by fingerprint) is sent once per `dedupeWindowSec`;
//    repeats are counted and reported as one summary when the window closes
//  - at most `maxPerMinute` distinct errors per source per minute; the rest
//    are rolled into a "N more errors" summary
class Alerter {
  constructor(publish, { host, dedupeWindowSec = 300, maxPerMinute = 6 } = {}) {
    this.publish = publish;
    this.host = host;
    this.windowMs = dedupeWindowSec * 1000;
    this.maxPerMinute = maxPerMinute;
    this.seen = new Map(); // fingerprint -> { source, firstLine, sentAt, repeats }
    this.minute = new Map(); // source -> { count, overflow }
    this.interval = setInterval(() => this.sweep(), 60 * 1000);
  }

  stop() {
    clearInterval(this.interval);
    this.sweep(true);
  }

  handle({ source, text }) {
    const fp = fingerprint(source, text);
    const existing = this.seen.get(fp);
    if (existing) {
      existing.repeats++;
      return;
    }

    const firstLine = text.split('\n').find((l) => l.trim()) || text;
    const bucket = this.minute.get(source) || { count: 0, overflow: [] };
    this.minute.set(source, bucket);
    if (bucket.count >= this.maxPerMinute) {
      bucket.overflow.push(firstLine);
      return;
    }
    bucket.count++;

    this.seen.set(fp, { source, firstLine, sentAt: Date.now(), repeats: 0 });
    log(`[alert] ${source}: ${firstLine}`);
    this.publish({
      title: `${source} error`,
      message: `${text}\n\n— ${this.host}`,
      priority: 4,
      tags: ['rotating_light', source],
    });
  }

  sweep(flushAll = false) {
    const now = Date.now();
    for (const [fp, entry] of this.seen) {
      if (!flushAll && now - entry.sentAt < this.windowMs) continue;
      this.seen.delete(fp);
      if (entry.repeats > 0) {
        this.publish({
          title: `${entry.source}: error repeated ${entry.repeats}×`,
          message: `Repeated ${entry.repeats} more times in the last ${Math.round((now - entry.sentAt) / 60000)}m:\n${entry.firstLine}\n\n— ${this.host}`,
          priority: 3,
          tags: ['repeat', entry.source],
        });
      }
    }

    for (const [source, bucket] of this.minute) {
      const { overflow } = bucket;
      if (overflow.length) {
        const listed = overflow.slice(0, 15).map((l) => `• ${l}`).join('\n');
        const more = overflow.length > 15 ? `\n…and ${overflow.length - 15} more` : '';
        this.publish({
          title: `${source}: ${overflow.length} more errors`,
          message: `Not sent individually (rate limit):\n${listed}${more}\n\n— ${this.host}`,
          priority: 4,
          tags: ['warning', source],
        });
      }
    }
    this.minute.clear();
  }
}

module.exports = { Alerter };
