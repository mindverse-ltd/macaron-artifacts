export interface PromptReference { path: string; label: string }
const referencePattern = /(^|\s)@([A-Za-z0-9_./-]{1,180})/g;
export function promptReferences(text: string): PromptReference[] {
  const seen = new Set<string>(), references: PromptReference[] = [];
  for (const match of text.matchAll(referencePattern)) {
    const path = match[2];
    if (seen.has(path)) continue;
    seen.add(path); references.push({ path, label: path === 'Canvas' ? 'Canvas' : path });
  }
  return references;
}
export function removePromptReference(text: string, path: string) { return text.replace(new RegExp(`(^|\\s)@${path.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?=\\s|$)`, 'g'), '$1').replace(/[ \t]{2,}/g, ' ').trimStart(); }
export function referenceQuery(text: string) { const match = /(?:^|\s)@([A-Za-z0-9_./-]*)$/.exec(text); return match?.[1] ?? null; }
