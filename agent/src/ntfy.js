const { truncate, log } = require('./util');

const MAX_MESSAGE = 3800; // ntfy rejects bodies over 4096 bytes

function createPublisher(ntfy) {
  const server = ntfy.server.replace(/\/+$/, '');
  let chain = Promise.resolve();

  async function send(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (ntfy.token) headers.Authorization = `Bearer ${ntfy.token}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(server, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          return body.id || true;
        }
        log(`[ntfy] publish failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) return false;
      } catch (err) {
        log(`[ntfy] publish error: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
    return false;
  }

  // Publishes are serialised so alerts arrive in order and we don't burst
  // past ntfy's rate limit. Resolves to the ntfy message id, or false.
  function publish({ title, message, priority = 3, tags = [], topic, click }) {
    const payload = {
      topic: topic || ntfy.topic,
      title,
      message: truncate(message || title, MAX_MESSAGE),
      priority,
      tags,
    };
    if (click) payload.click = click;
    const result = chain.then(() => send(payload));
    chain = result.catch(() => {});
    return result;
  }

  return { publish };
}

module.exports = { createPublisher };
