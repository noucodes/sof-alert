const EMOJI_TAGS = new Set(['rotating_light', 'warning', 'repeat', 'red_circle', 'green_circle', 'down', 'up', 'robot', 'test_tube']);

let alerts = [];
let status = null;
let filter = 'all';
let query = '';
const expanded = new Set();

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) node.append(c);
  }
  return node;
}

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function category(alert) {
  if (alert.tags.includes('down') || alert.tags.includes('up')) return 'outage';
  if (alert.tags.some((t) => ['rotating_light', 'warning', 'repeat'].includes(t))) return 'error';
  return 'info';
}

function severity(alert) {
  if (alert.tags.includes('up')) return 'ok';
  if (alert.priority >= 5) return 'critical';
  if (alert.priority >= 4) return 'error';
  return 'info';
}

// ---- rendering -----------------------------------------------------------

function renderStatus() {
  if (!status) return;
  const down = status.checks.filter((c) => c.status === 'down');
  const stale = status.agents.filter((a) => a.stale);

  $('overall-dot').className = `dot ${status.overall}`;
  let text = 'All systems normal';
  if (status.configError) text = 'Needs configuration';
  else if (down.length) text = `${down.length} service${down.length > 1 ? 's' : ''} down`;
  else if (stale.length) text = `${stale.length} agent${stale.length > 1 ? 's' : ''} silent`;
  else if (status.connection !== 'connected') text = 'Not connected to ntfy';
  else if (status.unread) text = `${status.unread} new alert${status.unread > 1 ? 's' : ''}`;
  $('overall-text').textContent = text;
  document.title = down.length ? `(${down.length} down) SOF Alert` : 'SOF Alert';

  const banner = $('banner');
  banner.hidden = !status.configError;
  banner.replaceChildren();
  if (status.configError) {
    banner.append(
      el('strong', {}, 'Config: '),
      status.configError,
      el('button', { class: 'ghost small', onclick: () => window.sof.openConfig() }, 'Open config file'),
    );
  }

  const paused = Date.now() < status.pausedUntil;
  $('btn-pause').textContent = paused ? 'Resume' : 'Pause 1h';
  $('btn-pause').classList.toggle('active', paused);

  $('checks').replaceChildren(
    ...(status.checks.length
      ? status.checks.map((c) => {
          const flaky = c.status === 'up' && c.error;
          return el(
            'div',
            { class: `card ${c.status}${flaky ? ' flaky' : ''}` },
            el('div', { class: 'card-head' }, el('span', { class: `dot ${dotColor(c, flaky)}` }), el('strong', {}, c.name)),
            el('div', { class: 'muted small target', title: c.target }, c.target),
            el(
              'div',
              { class: 'card-foot small' },
              c.status === 'down'
                ? el('span', { class: 'bad' }, `Down ${duration(Date.now() - c.downSince)} · ${c.error}`)
                : flaky
                  ? el('span', { class: 'warn' }, `Last check failed · ${c.error}`)
                  : el('span', { class: 'muted' }, c.ms != null ? `${c.ms} ms` : 'waiting…'),
              el('span', { class: 'muted' }, c.lastCheckedAt ? ago(c.lastCheckedAt) : ''),
            ),
          );
        })
      : [el('p', { class: 'muted small' }, 'No checks configured.')]),
  );

  $('agents').replaceChildren(
    ...(status.agents.length
      ? status.agents.map((a) =>
          el(
            'div',
            { class: `agent ${a.stale ? 'stale' : ''}` },
            el('span', { class: `dot ${a.stale ? 'red' : 'green'}` }),
            el('strong', {}, a.host),
            el('span', { class: 'muted small' }, `last heartbeat ${ago(a.lastSeen)}`),
            el(
              'button',
              { class: 'ghost small', title: 'Stop tracking this agent', onclick: () => window.sof.forgetAgent(a.host) },
              'Forget',
            ),
          ),
        )
      : [el('p', { class: 'muted small' }, 'No agent heartbeats yet. Start the agent on EC2 and the bridge PC.')]),
  );

  const conn = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected' }[status.connection];
  $('conn').textContent = `ntfy topic “${status.topic}” · ${conn}${status.connectionError && status.connection !== 'connected' ? ` (${status.connectionError})` : ''}`;
}

function dotColor(check, flaky) {
  if (check.status === 'down') return 'red';
  if (check.status === 'unknown') return 'grey';
  return flaky ? 'amber' : 'green';
}

function renderAlerts() {
  const q = query.toLowerCase();
  const visible = alerts.filter(
    (a) =>
      (filter === 'all' || category(a) === filter) &&
      (!q || a.title.toLowerCase().includes(q) || a.message.toLowerCase().includes(q)),
  );
  $('alert-count').textContent = alerts.length ? alerts.length : '';

  if (!visible.length) {
    $('alerts').replaceChildren(
      el('li', { class: 'empty muted' }, alerts.length ? 'No alerts match this filter.' : 'No alerts. Quiet is good.'),
    );
    return;
  }

  $('alerts').replaceChildren(
    ...visible.slice(0, 300).map((a) => {
      const open = expanded.has(a.id);
      const sources = a.tags.filter((t) => !EMOJI_TAGS.has(t));
      const preview = a.message.split('\n').find((l) => l.trim()) || '';
      return el(
        'li',
        {
          class: `alert ${severity(a)}${open ? ' open' : ''}`,
          onclick: (e) => {
            if (window.getSelection().toString()) return; // allow copying text
            if (e.target.closest('pre')) return;
            open ? expanded.delete(a.id) : expanded.add(a.id);
            renderAlerts();
          },
        },
        el(
          'div',
          { class: 'alert-head' },
          el('strong', { class: 'alert-title' }, a.title),
          ...sources.map((s) => el('span', { class: 'chip' }, s)),
          el('time', { class: 'muted small', title: new Date(a.time).toLocaleString() }, ago(a.time)),
        ),
        open ? el('pre', {}, a.message) : el('div', { class: 'preview muted small' }, preview),
      );
    }),
  );
}

// ---- wiring --------------------------------------------------------------

$('btn-run').addEventListener('click', () => window.sof.runChecks());
$('btn-config').addEventListener('click', () => window.sof.openConfig());
$('btn-clear').addEventListener('click', async () => {
  await window.sof.clearAlerts();
  alerts = [];
  renderAlerts();
});
$('btn-pause').addEventListener('click', () => {
  const paused = status && Date.now() < status.pausedUntil;
  window.sof.setPause(paused ? 0 : 60);
});
$('btn-test').addEventListener('click', async () => {
  const btn = $('btn-test');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const res = await window.sof.sendTest();
  btn.textContent = res.ok ? 'Sent ✓' : 'Failed';
  btn.title = res.error || 'Publish a test alert to ntfy (phone + this app)';
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Send test';
  }, 2500);
});
$('filter').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  filter = btn.dataset.filter;
  for (const b of $('filter').children) b.classList.toggle('active', b === btn);
  renderAlerts();
});
$('search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  renderAlerts();
});

window.sof.onStatus((s) => {
  status = s;
  renderStatus();
});
window.sof.onAlert((a) => {
  if (alerts.some((x) => x.id === a.id)) return;
  alerts.unshift(a);
  renderAlerts();
});

window.sof.getState().then((state) => {
  status = state.status;
  alerts = state.alerts;
  renderStatus();
  renderAlerts();
});

// keep relative times fresh
setInterval(() => {
  renderStatus();
  renderAlerts();
}, 30 * 1000);
