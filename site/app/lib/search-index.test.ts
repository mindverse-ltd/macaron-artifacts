import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { structure } from 'fumadocs-core/mdx-plugins/remark-structure';
import { sanitizeSearchText } from './search-index';

// Unit: the sanitizer strips markdown/entity artifacts WITHOUT mangling
// technical identifiers. The old regex stack turned `MACARON_CODEX_TRANSPORT`
// into `MACARONCODEXTRANSPORT` by treating intraword `_` as emphasis — the mdast
// pass must not.
test('sanitizeSearchText strips markup but preserves identifiers', () => {
  assert.equal(sanitizeSearchText('`mcx` is not a fork'), 'mcx is not a fork');
  assert.equal(sanitizeSearchText('published as **mcc** (the launcher)'), 'published as mcc (the launcher)');
  assert.equal(sanitizeSearchText('mcx&#x60; and &#x2A;*mcc*&#x2A;'), 'mcx and mcc');
  assert.equal(sanitizeSearchText('see [Usage](/docs/usage) now'), 'see Usage now');
  assert.equal(sanitizeSearchText('a &amp; b &lt; c'), 'a & b < c');
  // Underscored identifiers survive byte-for-byte (regression for the P1 leak).
  for (const id of ['MACARON_CODEX_TRANSPORT', 'MACARON_AUTH_TOKEN', 'permission_request', 'SEARCH_HL_OPEN', 'codex_approval_request']) {
    assert.equal(sanitizeSearchText(id), id, `identifier ${id} must survive sanitizing`);
    assert.equal(sanitizeSearchText(`sets \`${id}\` at boot`), `sets ${id} at boot`);
  }
  // Serialized MDX flow-component tags are removed, not left as searchable text.
  assert.equal(sanitizeSearchText('App shell. </Step> </Steps>'), 'App shell.');
  assert.equal(sanitizeSearchText('\\<Tabs items=\\{[1]}> <Tab value="x">'), '');
});

// Reproduce fumadocs' structure() extraction over the real MDX files (the same
// pass buildIndex consumes) and assert end-to-end that after sanitizing:
//  (a) no search chunk carries raw markup / MDX tags, and
//  (b) every underscored identifier that appears in the docs stays searchable.
const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../content/docs');

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return mdxFiles(full);
    return e.name.endsWith('.mdx') ? [full] : [];
  });
}

function sanitizedChunks(): string[] {
  return mdxFiles(DOCS_DIR).flatMap((file) => {
    const data = structure(readFileSync(file, 'utf8'));
    return [...data.headings.map((h) => h.content), ...data.contents.map((c) => c.content)].map(sanitizeSearchText);
  });
}

test('sanitized search chunks carry no markdown, entity, or MDX-tag markup', () => {
  const files = mdxFiles(DOCS_DIR);
  assert.ok(files.length > 0, 'expected at least one MDX doc');

  // `**` restricted to a real bold run (word chars either side) so glob paths
  // like `**/*.jsonl` don't false-positive; the last alternative catches MDX
  // tags such as <Step>/</Step>.
  const leaky = /`|\w\*\*\w|&#x?[0-9a-fA-F]+;|<\/?[A-Za-z][^>]*>/;
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

  // Guard: the raw extraction really does leak (backticks + serialized MDX tags),
  // so this test would catch a regression.
  assert.ok(rawOffenders.length > 0, 'expected raw structuredData to contain markup (else the test proves nothing)');
  assert.deepEqual(cleanOffenders, [], `sanitized search index still leaked markup:\n${cleanOffenders.join('\n')}`);
});

test('underscored identifiers stay searchable and MDX tags do not', () => {
  const haystack = sanitizedChunks().join('\n');

  // Any identifier the docs mention must appear verbatim in the index — searching
  // the real name must hit, not the underscore-stripped corruption.
  const identifiers = ['MACARON_CODEX_TRANSPORT', 'MACARON_AUTH_TOKEN', 'MACARON_ENGINE', 'permission_request', 'codex_approval_request'];
  const present = identifiers.filter((id) => haystack.includes(id));
  assert.ok(present.length > 0, 'expected the docs to mention at least one underscored identifier');
  for (const id of present) {
    assert.ok(!haystack.includes(id.replace(/_/g, '')), `corrupted identifier ${id.replace(/_/g, '')} must NOT be in the index`);
  }

  // Serialized MDX component tags must never be searchable.
  for (const tag of ['</Step>', '</Steps>', '<Tabs', '</Tab>', '<Accordion', '<TypeTable']) {
    assert.ok(!haystack.includes(tag), `MDX tag ${tag} must not appear in the search index`);
  }
});
