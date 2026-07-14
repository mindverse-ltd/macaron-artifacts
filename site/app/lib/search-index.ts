import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import type { source } from './source';

type Page = (typeof source)['$inferPage'];

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Decode the numeric / named HTML entities fumadocs' structure() emits for
// markdown punctuation (`&#x60;` → `, `&#x2A;` → *) BEFORE the markdown parse,
// so a decoded `*mcc*` is re-read as emphasis instead of surfacing literally.
function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => NAMED_ENTITIES[name] ?? name);
}

// structuredData chunks carry raw markdown (inline-code backticks, **bold**,
// [text](url) links) plus, for content nested in MDX flow components, serialized
// tag residue like `</Step>` / `<Tabs items={…}>`. The previous regex stack
// destroyed technical identifiers — a generic `_…_` emphasis rule stripped the
// underscores out of `MACARON_CODEX_TRANSPORT`, `permission_request`, etc., so
// those names became unsearchable. Parse the chunk into an mdast tree instead:
// CommonMark never treats intraword `_` as emphasis, so identifiers survive, and
// toString() drops the markdown syntax. A final tag-strip removes JSX/HTML tags
// (which matches on `<`/`>`, never `_`, so identifiers stay intact).
export function sanitizeSearchText(input: string): string {
  const text = toString(fromMarkdown(decodeEntities(input)));
  return text
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    // Drop stray backticks the AST left as literal text (a lone/unpaired `,
    // e.g. from a decoded `&#x60;`). Only backticks — never `_` or word chars —
    // so identifiers are untouched.
    .replace(/`+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Custom buildIndex passed to createFromSource: same shape as fumadocs' default
// extractor, but every heading and content chunk is sanitized so the static
// search JSON holds clean prose instead of markdown/entities.
export async function buildIndex(page: Page) {
  const structuredData = await page.data.structuredData;
  return {
    id: page.url,
    title: page.data.title ?? '',
    description: page.data.description,
    url: page.url,
    structuredData: {
      headings: structuredData.headings.map((h) => ({ ...h, content: sanitizeSearchText(h.content) })),
      contents: structuredData.contents.map((c) => ({ ...c, content: sanitizeSearchText(c.content) })),
    },
  };
}
