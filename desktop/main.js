const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell } = require('electron');
const { NtfySubscriber } = require('../agent/src/ntfy-subscriber');
const { statusIcon } = require('./icons');
const { CheckMonitor } = require('../agent/src/checks');
const { createNotifier } = require('../agent/src/notifier');
const { formatDuration } = require('../agent/src/util');

const MAX_ALERTS = 500;
const startHidden = process.argv.includes('--hidden');

let configPath;
let storePath;
let config;
let win;
let tray;
let subscriber;
let monitor;

// Persisted between runs: alert history, unread count and the last ntfy
// message id (so a restart resumes the stream instead of replaying it).
let store = { alerts: [], unread: 0, since: null, agents: {} };

const live = {
  connection: 'connecting',
  connectionError: null,
  checks: [],
  pausedUntil: 0,
  configError: null,
};
const staleAgents = new Set();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(init);
}

function init() {
  app.setAppUserModelId('com.burdens.sofalert');
  configPath = path.join(app.getPath('userData'), 'config.json');
  storePath = path.join(app.getPath('userData'), 'store.json');
  if (!fs.existsSync(configPath)) {
    fs.copyFileSync(path.join(__dirname, 'config.default.json'), configPath);
  }
  try {
    store = { ...store, ...JSON.parse(fs.readFileSync(storePath, 'utf8')) };
  } catch {
    // first run or corrupt store — start fresh
  }

  tray = new Tray(statusIcon('grey'));
  tray.setToolTip('SOF Alert');
  tray.on('click', showWindow);

  createWindow();
  if (!startHidden) showWindow();

  loadConfigAndStart();
  fs.watchFile(configPath, { interval: 1000 }, () => loadConfigAndStart());
  setInterval(checkAgents, 60 * 1000);

  registerIpc();
  refreshTray();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'SOF Alert',
    icon: statusIcon('green', 64),
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Closing hides to tray; the app keeps watching until Quit.
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('focus', markRead);
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
  markRead();
}

// ---- config / workers ---------------------------------------------------

function loadConfigAndStart() {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.ntfy?.topic || /CHANGE[-_]?ME/i.test(config.ntfy.topic)) {
      throw new Error('Set ntfy.topic in the config file to the same private topic the agents publish to.');
    }
    live.configError = null;
  } catch (err) {
    live.configError = err.message;
    config = config || JSON.parse(fs.readFileSync(path.join(__dirname, 'config.default.json'), 'utf8'));
  }

  subscriber?.stop();
  monitor?.stop();
  monitor?.removeAllListeners();

  if (!live.configError) startSubscriber();
  startMonitor();
  sendStatus();
}

function startSubscriber() {
  const { topic } = config.ntfy;
  live.connection = 'connecting';
  subscriber = new NtfySubscriber(config.ntfy, [topic, `${topic}-heartbeat`], store.since);
  subscriber.on('connected', () => {
    live.connection = 'connected';
    live.connectionError = null;
    sendStatus();
  });
  subscriber.on('disconnected', (err) => {
    live.connection = 'disconnected';
    live.connectionError = err.message;
    sendStatus();
  });
  subscriber.on('message', (msg) => {
    store.since = msg.id;
    if (msg.topic.endsWith('-heartbeat')) onHeartbeat(msg);
    else onAlert(msg);
    saveStoreSoon();
  });
  subscriber.start();
}

function startMonitor() {
  monitor = new CheckMonitor(config.checks || [], config.checkOptions);
  monitor.on('update', (states) => {
    live.checks = states;
    sendStatus();
  });
  monitor.on('down', (s) => notify(`${s.name} is DOWN`, `${s.target}\n${s.error}`, true));
  monitor.on('reminder', (s) =>
    notify(`${s.name} still DOWN (${formatDuration(Date.now() - s.downSince)})`, s.error, true),
  );
  monitor.on('up', (s, downtime) => notify(`${s.name} recovered`, `Back up after ${formatDuration(downtime)}`));
  live.checks = monitor.snapshot();
  monitor.start();
}

// ---- incoming messages ---------------------------------------------------

function onAlert(msg) {
  if (store.alerts.some((a) => a.id === msg.id)) return;
  const alert = {
    id: msg.id,
    time: msg.time * 1000,
    title: msg.title || 'Alert',
    message: msg.message || '',
    priority: msg.priority || 3,
    tags: msg.tags || [],
  };
  store.alerts.unshift(alert);
  store.alerts.length = Math.min(store.alerts.length, MAX_ALERTS);

  const windowActive = win?.isVisible() && win.isFocused();
  if (!windowActive && alert.priority >= 3) store.unread++;

  // Don't re-notify for backlog delivered when the stream (re)connects.
  const fresh = Date.now() - alert.time < 2 * 60 * 1000;
  if (fresh && alert.priority >= (config.notify?.minPriority ?? 3)) {
    notify(alert.title, alert.message.split('\n').slice(0, 4).join('\n'), alert.priority >= 5);
  }

  win?.webContents.send('alert', alert);
  sendStatus();
}

function onHeartbeat(msg) {
  const host = msg.title || 'unknown';
  store.agents[host] = msg.time * 1000;
  if (staleAgents.delete(host)) notify(`Agent on ${host} is back`, 'Heartbeats resumed.');
  sendStatus();
}

function checkAgents() {
  const staleMs = (config?.agentStaleMin || 12) * 60 * 1000;
  for (const [host, lastSeen] of Object.entries(store.agents)) {
    const stale = Date.now() - lastSeen > staleMs;
    if (stale && !staleAgents.has(host) && live.connection === 'connected') {
      staleAgents.add(host);
      notify(
        `No heartbeat from ${host}`,
        `Last seen ${formatDuration(Date.now() - lastSeen)} ago. The agent or the machine may be down.`,
        true,
      );
    }
  }
  sendStatus();
}

// ---- notifications / tray ------------------------------------------------

function notify(title, body, urgent = false) {
  if (config?.notify?.desktop === false || Date.now() < live.pausedUntil) return;
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: body || '', urgency: urgent ? 'critical' : 'normal' });
  n.on('click', showWindow);
  n.show();
}

function overallStatus() {
  if (live.configError) return 'grey';
  if (live.checks.some((c) => c.status === 'down') || staleAgents.size) return 'red';
  if (live.connection !== 'connected') return 'grey';
  if (store.unread > 0) return 'amber';
  return 'green';
}

function refreshTray() {
  if (!tray) return;
  const status = overallStatus();
  tray.setImage(statusIcon(status));
  win?.setIcon(statusIcon(status, 64));
  const down = live.checks.filter((c) => c.status === 'down').map((c) => c.name);
  const lines = ['SOF Alert'];
  if (down.length) lines.push(`Down: ${down.join(', ')}`);
  if (staleAgents.size) lines.push(`Silent agents: ${[...staleAgents].join(', ')}`);
  if (store.unread) lines.push(`${store.unread} unread alert(s)`);
  if (live.connection !== 'connected') lines.push(`ntfy: ${live.connection}`);
  tray.setToolTip(lines.join('\n').slice(0, 127));

  const paused = Date.now() < live.pausedUntil;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open SOF Alert', click: showWindow },
      { type: 'separator' },
      paused
        ? { label: 'Resume notifications', click: () => setPause(0) }
        : { label: 'Pause notifications for 1 hour', click: () => setPause(60) },
      { label: 'Send test alert', click: sendTest },
      { label: 'Edit config…', click: () => shell.openPath(configPath) },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function setPause(minutes) {
  live.pausedUntil = minutes ? Date.now() + minutes * 60 * 1000 : 0;
  sendStatus();
}

function markRead() {
  if (!store.unread) return;
  store.unread = 0;
  saveStoreSoon();
  sendStatus();
}

async function sendTest() {
  if (live.configError) return { ok: false, error: live.configError };
  const { notify, push } = createNotifier(config, {
    devicesFile: path.join(app.getPath('userData'), 'devices.json'),
  });
  await push?.sync().catch(() => {});
  const ok = await notify({
    title: 'Test alert',
    message: 'If this reached your phone and this app, alerts are working.',
    priority: 4,
    tags: ['test_tube'],
  });
  return ok ? { ok: true } : { ok: false, error: 'Publishing to ntfy failed — check server/topic/token.' };
}

// ---- renderer bridge -----------------------------------------------------

function statusPayload() {
  const staleMs = (config?.agentStaleMin || 12) * 60 * 1000;
  return {
    overall: overallStatus(),
    connection: live.connection,
    connectionError: live.connectionError,
    configError: live.configError,
    configPath,
    topic: config?.ntfy?.topic,
    pausedUntil: live.pausedUntil,
    unread: store.unread,
    checks: live.checks,
    agents: Object.entries(store.agents)
      .map(([host, lastSeen]) => ({ host, lastSeen, stale: Date.now() - lastSeen > staleMs }))
      .sort((a, b) => a.host.localeCompare(b.host)),
  };
}

function sendStatus() {
  refreshTray();
  win?.webContents.send('status', statusPayload());
}

function registerIpc() {
  ipcMain.handle('state:get', () => ({ status: statusPayload(), alerts: store.alerts }));
  ipcMain.handle('alerts:clear', () => {
    store.alerts = [];
    store.unread = 0;
    saveStoreSoon();
    sendStatus();
  });
  ipcMain.handle('agents:forget', (_e, host) => {
    delete store.agents[host];
    staleAgents.delete(host);
    saveStoreSoon();
    sendStatus();
  });
  ipcMain.handle('config:open', () => shell.openPath(configPath));
  ipcMain.handle('ntfy:test', sendTest);
  ipcMain.handle('pause:set', (_e, minutes) => setPause(minutes));
  ipcMain.handle('checks:run', () => monitor?.tick());
}

let saveTimer;
function saveStoreSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(storePath, JSON.stringify(store), () => {});
  }, 1000);
}

app.on('before-quit', () => {
  app.isQuitting = true;
  clearTimeout(saveTimer);
  try {
    fs.writeFileSync(storePath, JSON.stringify(store));
  } catch {
    // best effort
  }
});

// Stay alive in the tray when the window is closed.
app.on('window-all-closed', () => {});
