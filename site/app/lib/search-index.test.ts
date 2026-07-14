import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { structure } from 'fumadocs-core/mdx-plugins/remark-structure';
import { sanitizeSearchText } from './search-index';

// Unit: the sanitizer strips every markdown/entity artifact the review flagged.
test('sanitizeSearchText strips markdown and HTML entities', () => {
  assert.equal(sanitizeSearchText('`mcx` is not a fork'), 'mcx is not a fork');
  assert.equal(sanitizeSearchText('published as **mcc** (the launcher)'), 'published as mcc (the launcher)');
  assert.equal(sanitizeSearchText('mcx&#x60; and &#x2A;*mcc*&#x2A;'), 'mcx and mcc');
  assert.equal(sanitizeSearchText('see [Usage](/docs/usage) now'), 'see Usage now');
  assert.equal(sanitizeSearchText('a &amp; b &lt; c'), 'a & b < c');
});

// Reproduce fumadocs' structure() extraction over the real MDX files (the same
// pass buildIndex consumes) and assert that after sanitizing, no search chunk
// carries raw markup. This is the exact leak from the review — searching
// "Server" surfaced `mcx&#x60;` and `&#x2A;*mcc*&#x2A;`.
const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../content/docs');

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return mdxFiles(full);
    return e.name.endsWith('.mdx') ? [full] : [];
  });
}

test('sanitized search chunks carry no markdown or entity markup', () => {
  const files = mdxFiles(DOCS_DIR);
  assert.ok(files.length > 0, 'expected at least one MDX doc');

  const leaky = /`|\*\*|&#x?[0-9a-fA-F]+;/;
  const rawOffenders: string[] = [];
  const cleanOffenders: string[] = [];

  for (const file of files) {
    const data = structure(readFileSync(file, 'utf8'));
    const chunks = [...data.headings.map((h) => h.content), ...data.contents.map((c) => c.content)];
    for (const chunk of chunks) {
      if (leaky.test(chunk)) rawOffenders.push(chunk);
      if (leaky.test(sanitizeSearchText(chunk))) cleanOffenders.push(`${path.basename(file)}: ${chunk.slice(0, 80)}`);
    }
  }

  // Guard: the raw extraction really does leak, so this test would catch a regression.
  assert.ok(rawOffenders.length > 0, 'expected raw structuredData to contain markup (else the test proves nothing)');
  // After sanitizing, nothing leaks.
  assert.deepEqual(cleanOffenders, [], `sanitized search index still leaked markup:\n${cleanOffenders.join('\n')}`);
});
