// Tolerant partial-JSON helper for extracting a string field from an
// in-progress JSON blob (Claude streams the tool_input as `accumulated`).
// Returns '' if the field hasn't started yet.

export function extractPartialCode(raw: string, field = 'code'): string {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`);
  const m = re.exec(raw);
  if (!m) return '';
  return m[1]
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}
