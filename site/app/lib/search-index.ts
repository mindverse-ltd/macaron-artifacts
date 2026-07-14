import type { source } from './source';

type Page = (typeof source)['$inferPage'];

// structuredData carries the raw markdown/HTML-entity noise that fumadocs'
// structure() pass leaves in place — inline code backticks, `**bold**`,
// `[text](url)` links, and numeric entities like `&#x60;` (`) / `&#x2A;` (*).
// Left as-is they surface verbatim in search result summaries (e.g. searching
// "Server" showed `mcx&#x60;` and `&#x2A;*mcc*&#x2A;`). Strip them to plain text.
export function sanitizeSearchText(input: string): string {
  return input
    // Decode the numeric HTML entities structure() emits for markdown punctuation.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    // [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // **bold** / __bold__ / *em* / _em_ → inner text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // strip stray inline-code backticks
    .replace(/`+/g, '')
    // collapse whitespace the removals may have left behind
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
