const { spawn } = require('child_process');
const readline = require('readline');
const { EntryAssembler } = require('../assembler');
const { stripAnsi, log } = require('../util');

// Follows systemd units via `journalctl -f -o json`. Each unit gets its own
// assembler so interleaved output from two services isn't merged. `journalctl
// -u` also includes systemd's own messages about the unit (crashes, restarts).
class JournaldSource {
  constructor(cfg, onEntry) {
    this.name = cfg.name;
    this.units = cfg.units;
    this.match = new RegExp(cfg.match, 'i');
    this.entryStart = cfg.entryStart;
    this.onEntry = onEntry;
    this.assemblers = new Map();
    this.stopped = false;
  }

  start() {
    const args = ['-f', '-n', '0', '-o', 'json', ...this.units.flatMap((u) => ['-u', u])];
    this.proc = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    log(`[${this.name}] following journald units: ${this.units.join(', ')}`);

    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.handle(line));
    this.proc.stderr.on('data', (d) => log(`[${this.name}] journalctl: ${d.toString().trim()}`));
    this.proc.on('error', (err) => log(`[${this.name}] journalctl failed: ${err.message}`));
    this.proc.on('exit', (code) => {
      if (this.stopped) return;
      log(`[${this.name}] journalctl exited (${code}), restarting in 5s`);
      setTimeout(() => this.start(), 5000);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }

  handle(line) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return;
    }
    let message = rec.MESSAGE;
    if (Array.isArray(message)) message = Buffer.from(message).toString('utf8');
    if (typeof message !== 'string') return;

    // systemd's own messages about a unit come from init.scope with UNIT set;
    // they're single lines, so they bypass entry grouping.
    if (rec._SYSTEMD_UNIT === 'init.scope') {
      this.emit(rec.UNIT || 'unknown', stripAnsi(message));
      return;
    }

    const unit = rec._SYSTEMD_UNIT || rec.UNIT || 'unknown';
    let assembler = this.assemblers.get(unit);
    if (!assembler) {
      assembler = new EntryAssembler({
        entryStart: this.entryStart,
        onEntry: (text) => this.emit(unit, text),
      });
      this.assemblers.set(unit, assembler);
    }
    for (const l of stripAnsi(message).split('\n')) assembler.push(l);
  }

  emit(unit, text) {
    if (!this.match.test(text)) return;
    const source = this.units.length > 1 ? unit.replace(/\.service$/, '') : this.name;
    this.onEntry({ source, text });
  }
}

module.exports = { JournaldSource };
