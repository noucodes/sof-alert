const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '');
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + '\n… (truncated)';
}

// Collapses volatile parts (ids, numbers, timestamps, quoted values) so the
// same error repeated for different orders is recognised as one problem.
function fingerprint(source, text) {
  const firstLine = text.split('\n').find((l) => l.trim()) || '';
  const normalised = firstLine
    .replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/, '')
    .replace(/^\[Nest\]\s+\d+\s+-\s+.*?\s(?=(LOG|ERROR|WARN|DEBUG|VERBOSE|FATAL)\b)/, '[Nest] ')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/"[^"]*"|'[^']*'/g, '<str>')
    .replace(/#?\b[A-Z]*\d[\w-]*\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
  return `${source}|${normalised}`;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

module.exports = { stripAnsi, truncate, fingerprint, formatDuration, log };
