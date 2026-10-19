const fs = require('fs');
const path = require('path');
const { EntryAssembler } = require('../assembler');
const { stripAnsi, log } = require('../util');

const MAX_READ = 1024 * 1024; // bytes read per file per poll

// Tails every file in `dir` whose name matches `pattern`. Handles winston's
// daily rotation: files that exist at startup are read from their current end
// (no replay of old errors), files that appear later are read from the start.
class FileSource {
  constructor(cfg, onEntry) {
    this.name = cfg.name;
    this.dir = cfg.dir;
    this.pattern = new RegExp(cfg.pattern);
    this.match = cfg.match ? new RegExp(cfg.match, 'i') : null;
    this.entryStart = cfg.entryStart;
    this.pollMs = cfg.pollMs || 2000;
    this.onEntry = onEntry;
    this.files = new Map();
    this.busy = false;
  }

  async start() {
    await this.scan(true);
    log(`[${this.name}] watching ${this.dir} (${this.files.size} matching files)`);
    this.interval = setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    clearInterval(this.interval);
  }

  async scan(initial) {
    let names;
    try {
      names = await fs.promises.readdir(this.dir);
    } catch (err) {
      if (!this.dirMissingLogged) log(`[${this.name}] cannot read ${this.dir}: ${err.message}`);
      this.dirMissingLogged = true;
      return;
    }
    this.dirMissingLogged = false;

    for (const name of names) {
      if (!this.pattern.test(name) || this.files.has(name)) continue;
      let offset = 0;
      if (initial) {
        try {
          offset = (await fs.promises.stat(path.join(this.dir, name))).size;
        } catch {
          continue;
        }
      }
      this.files.set(name, {
        offset,
        remainder: '',
        assembler: new EntryAssembler({
          entryStart: this.entryStart,
          onEntry: (text) => this.emit(text),
        }),
      });
    }
  }

  emit(text) {
    text = stripAnsi(text);
    if (this.match && !this.match.test(text)) return;
    this.onEntry({ source: this.name, text });
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.scan(false);
      for (const [name, state] of this.files) {
        await this.readNew(name, state);
      }
    } catch (err) {
      log(`[${this.name}] poll error: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  async readNew(name, state) {
    const file = path.join(this.dir, name);
    let size;
    try {
      size = (await fs.promises.stat(file)).size;
    } catch {
      state.assembler.flush();
      this.files.delete(name); // rotated away / deleted
      return;
    }
    if (size < state.offset) state.offset = 0; // truncated
    if (size === state.offset) return;

    const length = Math.min(size - state.offset, MAX_READ);
    const buf = Buffer.alloc(length);
    const fh = await fs.promises.open(file, 'r');
    try {
      await fh.read(buf, 0, length, state.offset);
    } finally {
      await fh.close();
    }
    state.offset += length;

    const lines = (state.remainder + buf.toString('utf8')).split(/\r?\n/);
    state.remainder = lines.pop();
    for (const line of lines) state.assembler.push(line);
  }
}

module.exports = { FileSource };
