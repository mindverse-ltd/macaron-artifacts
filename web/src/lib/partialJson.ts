// Tolerant partial-JSON helpers for streaming JSON from LLMs.
// - extractPartialCode: pull a single string field from an in-progress blob
//   (Claude streams tool_input as `accumulated`); returns '' until it starts.
// - parseFollowups: parse a streaming JSON array of question strings, dropping
//   any element that isn't a fully-closed string so chips never render half-typed.

import { Allow, parse } from 'partial-json';

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

// partial-json with Allow.ARR completes an unclosed array but drops any element
// that isn't a fully-closed string — so a chip appears only once its question
// is whole, never half-typed. Mirrors free-chat's iterateSuggestion.
export function parseFollowups(raw: string): string[] {
  const i = raw.indexOf('[');
  if (i < 0) return [];
  try {
    const parsed = parse(raw.slice(i), Allow.ARR);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
