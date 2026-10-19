const fs = require('fs');
const path = require('path');
const { createPublisher } = require('./ntfy');
const { Alerter } = require('./alerter');
const { CheckMonitor } = require('./checks');
const { FileSource } = require('./sources/file');
const { JournaldSource } = require('./sources/journald');
const { formatDuration, log } = require('./util');

function loadConfig() {
  const file = path.resolve(process.argv[2] || process.env.SOF_ALERT_CONFIG || path.join(__dirname, '..', 'config.json'));
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.ntfy?.server || !config.ntfy?.topic || /CHANGE[-_]?ME/i.test(config.ntfy.topic)) {
    throw new Error(`${file}: set ntfy.server and a private ntfy.topic`);
  }
  config.host = config.host || require('os').hostname();
  config.sources = config.sources || [];
  config.checks = config.checks || [];
  log(`config loaded from ${file}`);
  return config;
}

function main() {
  const config = loadConfig();
  const { publish } = createPublisher(config.ntfy);
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
