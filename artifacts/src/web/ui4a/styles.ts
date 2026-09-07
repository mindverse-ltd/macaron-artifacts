import { createGenerator } from "@unocss/core";
import { unoConfig } from "../theme/uno";

export const UI4A_CLASS = "ui4a-surface";
let generator: ReturnType<typeof createGenerator> | null = null;
let sheet: HTMLStyleElement | null = null;
let pending = Promise.resolve();
let generation = 0;
let preflighted = false;
const sources = new Map<symbol, Set<string>>();
const emitted = new Set<string>();
const scopedReset = `:where(.${UI4A_CLASS}) :where(*, *::before, *::after) { box-sizing: border-box; }\n:where(.${UI4A_CLASS}) :where(button, input, select, textarea) { color: inherit; font: inherit; background: transparent; border: 0 solid; }\n:where(.${UI4A_CLASS}) :where(button) { cursor: pointer; }\n:where(.${UI4A_CLASS}) :where(input, select, textarea) { cursor: text; }\n:where(.${UI4A_CLASS}) :where(h1,h2,h3,h4,h5,h6,p,figure,blockquote,pre,dl,dd) { margin: 0; }\n:where(.${UI4A_CLASS}) :where(ul,ol) { margin: 0; padding: 0; list-style: none; }`;

/** Keep rules local to generated surfaces; an unscoped utility arriving last can otherwise restyle the chat shell. */
export function createSurfaceStyles(root: HTMLElement) {
  const key = Symbol();
  sources.set(key, new Set());
  let sequence = 0;
  let source = "";
  let streaming = true;
  const update = (code: string, partial: boolean) => {
    source = code;
    streaming = partial;
    const current = ++sequence;
    const epoch = generation;
    const classes = [...root.querySelectorAll("[class]")].map((element) => element.getAttribute("class") ?? "").join(" ");
    pending = pending.then(async () => {
      if (epoch !== generation || current !== sequence || !sources.has(key)) return;
      const uno = await (generator ??= createGenerator(unoConfig(`.${UI4A_CLASS}`)));
      const tokens = await uno.applyExtractors(`${code}\n${classes}`);
      if (epoch !== generation || current !== sequence || !sources.has(key)) return;
      sources.set(key, tokens);
      const fresh = [...tokens].filter((token) => !emitted.has(token));
      if (partial && preflighted && fresh.length === 0) return;
      if (!sheet) { sheet = document.createElement("style"); sheet.dataset.ui4a = "utilities"; document.head.append(sheet); }
      if (!partial) {
        emitted.clear();
        for (const values of sources.values()) for (const token of values) emitted.add(token);
        const { css } = await uno.generate(emitted, { preflights: true });
        if (epoch === generation && sheet) sheet.textContent = scopedReset + css;
        preflighted = true;
      } else {
        for (const token of fresh) emitted.add(token);
        const { css } = await uno.generate(fresh, { preflights: !preflighted });
        if (epoch === generation && sheet) sheet.textContent += (preflighted ? "" : scopedReset) + css;
        preflighted = true;
      }
    }).catch((error) => console.error("[ui4a] style generation failed", error));
    return pending;
  };
  const observer = new MutationObserver(() => { void update(source, streaming); });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  return {
    update,
    dispose() {
      sequence++;
      observer.disconnect();
      sources.delete(key);
      if (!sources.size) { generation++; sheet?.remove(); sheet = null; emitted.clear(); preflighted = false; }
    },
  };
}
