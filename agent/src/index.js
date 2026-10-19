const fs = require('fs');
const path = require('path');
const { createNotifier } = require('./notifier');
const { Alerter } = require('./alerter');
const { CheckMonitor } = require('./checks');
const { FileSource } = require('./sources/file');
const { JournaldSource } = require('./sources/journald');
const { formatDuration, log } = require('./util');

const args = process.argv.slice(2);
const testMode = args.includes('--test');
const configArg = args.find((a) => !a.startsWith('--'));

function loadConfig() {
  const file = path.resolve(configArg || process.env.SOF_ALERT_CONFIG || path.join(__dirname, '..', 'config.json'));
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.ntfy?.server || !config.ntfy?.topic || /CHANGE[-_]?ME/i.test(config.ntfy.topic)) {
    throw new Error(`${file}: set ntfy.server and a private ntfy.topic`);
  }
  config.host = config.host || require('os').hostname();
  config.sources = config.sources || [];
  config.checks = config.checks || [];
  log(`config loaded from ${file}`);
  config.devicesFile = path.join(path.dirname(file), 'devices.json');
  return config;
}

// `node src/index.js config.json --test` sends one alert through ntfy and
// push, then exits — for checking the phone setup end to end.
async function sendTest(config) {
  const { notify, push } = createNotifier(config, { devicesFile: config.devicesFile });
  if (push) {
    await push.sync();
    log(`[test] ${push.devices.size} registered device(s)`);
  }
  const id = await notify({
    title: `Test alert from ${config.host}`,
    message: 'If this reached your phone and the desktop app, alerts are working.',
    priority: 4,
    tags: ['test_tube'],
  });
  log(id ? `[test] sent (ntfy id ${id})` : '[test] ntfy publish failed');
  process.exit(id ? 0 : 1);
}

function main() {
  const config = loadConfig();
  if (testMode) return sendTest(config);

  const { notify: publish, push } = createNotifier(config, { devicesFile: config.devicesFile });
  push?.start();
  const alerter = new Alerter(publish, { host: config.host, ...config.alerts });
  const onEntry = (entry) => alerter.handle(entry);

  const sources = config.sources.map((cfg) => {
    if (cfg.type === 'file') return new FileSource(cfg, onEntry);
    if (cfg.type === 'journald') return new JournaldSource(cfg, onEntry);
    throw new Error(`source "${cfg.name}": unknown type "${cfg.type}"`);
  });
  sources.forEach((s) => s.start());

  const monitor = new CheckMonitor(config.checks, config.checkOptions);
  monitor.on('down', (s) => {
    log(`[check] ${s.name} DOWN: ${s.error}`);
    publish({
      title: `${s.name} is DOWN`,
      message: `${s.target}\n${s.error}\n\nChecked from ${config.host}`,
      priority: 5,
      tags: ['red_circle', 'down'],
    });
  });
  monitor.on('reminder', (s) => {
    publish({
      title: `${s.name} still DOWN (${formatDuration(Date.now() - s.downSince)})`,
      message: `${s.target}\n${s.error}\n\nChecked from ${config.host}`,
      priority: 5,
      tags: ['red_circle', 'down'],
    });
  });
  monitor.on('up', (s, downtime) => {
    log(`[check] ${s.name} recovered after ${formatDuration(downtime)}`);
    publish({
      title: `${s.name} recovered`,
      message: `${s.target} is back up after ${formatDuration(downtime)}.\n\nChecked from ${config.host}`,
      priority: 3,
      tags: ['green_circle', 'up'],
    });
  });
  if (config.checks.length) monitor.start();

  // Heartbeats go to a side topic the desktop app watches, so a dead agent is
  // noticed. The phone only subscribes to the main topic and never sees these.
  const heartbeatTopic = `${config.ntfy.topic}-heartbeat`;
  const heartbeat = () =>
    publish({ topic: heartbeatTopic, title: config.host, message: `alive ${new Date().toISOString()}`, priority: 1 });
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, (config.heartbeatMin || 5) * 60 * 1000);

  publish({
    title: `Alert agent started on ${config.host}`,
    message: `Watching ${sources.length} log source(s) and ${config.checks.length} health check(s).`,
    priority: 2,
    tags: ['robot'],
  });

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}, stopping`);
    clearInterval(heartbeatTimer);
    push?.stop();
    sources.forEach((s) => s.stop());
    monitor.stop();
    alerter.stop();
    await Promise.race([
      publish({ title: `Alert agent stopped on ${config.host}`, message: `Stopped (${signal}).`, priority: 3, tags: ['robot'] }),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  // Keep running through unexpected errors — a crashed watcher is worse
  // than a noisy log line.
  process.on('uncaughtException', (err) => log('uncaught exception:', err));
  process.on('unhandledRejection', (err) => log('unhandled rejection:', err));
}

main();
