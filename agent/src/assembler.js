const MAX_LINES = 200;

// Groups raw log lines into entries. Winston and Nest write stack traces and
// metadata on the lines following the header, so an entry runs from one line
// matching `entryStart` up to the next one (or until the stream goes idle).
// Without `entryStart`, every line is its own entry.
class EntryAssembler {
  constructor({ entryStart, idleMs = 1500, onEntry }) {
    this.entryStart = entryStart ? new RegExp(entryStart) : null;
    this.idleMs = idleMs;
    this.onEntry = onEntry;
    this.lines = [];
    this.timer = null;
  }

  push(line) {
    if (!this.entryStart) {
      if (line.trim()) this.onEntry(line);
      return;
    }
    if (this.entryStart.test(line) && this.lines.length) this.flush();
    if (this.lines.length < MAX_LINES) this.lines.push(line);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.idleMs);
  }

  flush() {
    clearTimeout(this.timer);
    const text = this.lines.join('\n').trim();
    this.lines = [];
    if (text) this.onEntry(text);
  }
}

module.exports = { EntryAssembler };
