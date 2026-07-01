const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BLOCK_FOLLOWERS: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
const BLOCK_CLOSERS = new Set(Object.values(BLOCK_FOLLOWERS));
type CompletionFrame = { type: "block"; closer: string; statement: boolean; open?: number } | { type: "jsx"; tag: string };

const stripMarkdownFence = (code: string) => {
  let next = code.trim();
  next = next.replace(/^```(?:[^\r\n]*)?(?:\r?\n|$)/i, "");
  next = next.replace(/\s*```$/i, "");
  return next;
};
const maskExportScanRange = (chars: string[], start: number, end: number) => {
  for (let index = start; index < end; index += 1) if (chars[index] !== "\n") chars[index] = " ";
};
const findStringLiteralEnd = (code: string, index: number) => {
  const quote = code[index];
  index += 1;
  while (index < code.length) {
    if (code[index] === "\\") index += 2;
    else {
      if (code[index] === quote) return index + 1;
      index += 1;
    }
  }
  return code.length;
};
const findTemplateLiteralEnd = (code: string, index: number) => {
  index += 1;
  while (index < code.length) {
    if (code[index] === "\\") index += 2;
    else if (code[index] === "`") return index + 1;
    // A `${ … }` substitution can hold nested template literals (`${`inner`}`); recurse into it so an inner backtick is not
    // mistaken for the outer literal's terminator, which would leave the substitution body unmasked in the export scan. Skip
    // strings/templates inside the substitution so their braces (`${"{"}`) do not throw off the brace-depth tracking.
    else if (code[index] === "$" && code[index + 1] === "{") {
      index += 2;
      for (let depth = 1; index < code.length && depth > 0; index += 1) {
        if (code[index] === "/" && code[index + 1] === "/") {
          const next = code.indexOf("\n", index + 2);
          index = next === -1 ? code.length : next;
        } else if (code[index] === "/" && code[index + 1] === "*") {
          const next = code.indexOf("*/", index + 2);
          index = next === -1 ? code.length : next + 1;
        } else if (isLikelyRegexLiteralStart(code, index)) index = findRegexLiteralEnd(code, index) - 1;
        else if (code[index] === "`") index = findTemplateLiteralEnd(code, index) - 1;
        else if (code[index] === '"' || code[index] === "'") index = findStringLiteralEnd(code, index) - 1;
        else if (code[index] === "{") depth += 1;
        else if (code[index] === "}") depth -= 1;
      }
    } else index += 1;
  }
  return code.length;
};
const updateJsxStackForTag = (stack: CompletionFrame[], tag: string) => {
  const match = /^<\/?\s*([A-Za-z][\w$.-]*)/.exec(tag);
  const tagName = match?.[1] ?? (tag === "<>" || tag === "</>" ? "" : null);
  if (tagName === null) return;
  if (tag.startsWith("</")) {
    const frame = stack.at(-1);
    if (frame?.type === "jsx" && frame.tag === tagName) stack.pop();
    return;
  }
  if (!tag.endsWith("/>") && !VOID_TAGS.has(tagName)) stack.push({ type: "jsx", tag: tagName });
};
const maskIgnoredTextForExportScan = (code: string) => {
  // split("") keeps code-unit indexing aligned with code[index]; spread would split astral chars (emoji) by code point and desync the two.
  const chars = code.split("");
  const stack: CompletionFrame[] = [];
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (isInsideJsxText(stack) && char !== "<" && char !== "{") {
      if (chars[index] !== "\n") chars[index] = " ";
      continue;
    }
    if (char === "/" && code[index + 1] === "/") {
      const end = code.indexOf("\n", index + 2);
      const next = end === -1 ? code.length : end;
      maskExportScanRange(chars, index, next);
      index = next;
      continue;
    }
    if (char === "/" && code[index + 1] === "*") {
      const close = code.indexOf("*/", index + 2);
      const next = close === -1 ? code.length : close + 2;
      maskExportScanRange(chars, index, next);
      index = next - 1;
      continue;
    }
    if (isLikelyRegexLiteralStart(code, index)) {
      const next = findRegexLiteralEnd(code, index);
      maskExportScanRange(chars, index, next);
      index = next - 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const next = findStringLiteralEnd(code, index);
      maskExportScanRange(chars, index, next);
      index = next - 1;
      continue;
    }
    if (char === "`") {
      const next = findTemplateLiteralEnd(code, index);
      maskExportScanRange(chars, index, next);
      index = next - 1;
      continue;
    }
    if (char === "<" && shouldStartJsxTag(code, index, stack)) {
      const closeIndex = findJsxTagEnd(code, index);
      if (closeIndex === -1) break;
      const tag = code.slice(index, closeIndex + 1);
      maskExportScanRange(chars, index, closeIndex + 1);
      chars[index] = "<"; // keep the leading `<` so `export default <Card/>` is still detectable after masking
      index = closeIndex;
      updateJsxStackForTag(stack, tag);
      continue;
    }
    if (char in BLOCK_FOLLOWERS) {
      stack.push({ type: "block", closer: BLOCK_FOLLOWERS[char], statement: false });
      continue;
    }
    if (BLOCK_CLOSERS.has(char)) {
      const frame = stack.at(-1);
      if (frame?.type === "block" && frame.closer === char) stack.pop();
    }
  }
  return chars.join("");
};
const findBalancedTypeArgumentsEnd = (code: string, index: number) => {
  if (code[index] !== "<") return index;
  let depth = 0;
  for (; index < code.length; index += 1) {
    const char = code[index];
    if (char === "<") depth += 1;
    else if (char === ">" && code[index - 1] === "=") continue;
    else if (char === ">") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
};
const findWrappedComponentCallOpen = (code: string, index: number) => {
  index = findBalancedTypeArgumentsEnd(code, index);
  if (index === -1) return -1;
  while (/\s/.test(code[index] ?? "")) index += 1;
  return code[index] === "(" ? index : -1;
};
const isWrappedImplementationFunction = (code: string, index: number) => /\b(?:memo|forwardRef)\s*(?:<[\s\S]*>)?\s*\($/.test(code.slice(0, index).trimEnd());

const findLastExportableComponent = (code: string) => {
  const candidates: Array<{ name: string; index: number }> = [];
  for (const match of code.matchAll(/\bfunction\s+([A-Z][\w$]*)\s*\(/g)) {
    if (!isWrappedImplementationFunction(code, match.index ?? 0)) candidates.push({ name: match[1], index: match.index ?? 0 });
  }
  for (const match of code.matchAll(/\bclass\s+([A-Z][\w$]*)\s+extends\s+(?:(?:React\.)?(?:Pure)?Component|[A-Za-z_$][\w$]*\.Component)\b/g)) candidates.push({ name: match[1], index: match.index ?? 0 });
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Z][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>/g)) candidates.push({ name: match[1], index: match.index ?? 0 });
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Z][\w$]*)\s*(?::[^=]+)?=\s*(?:[A-Za-z_$][\w$]*\.)?(?:memo|forwardRef)\s*/g)) {
    if (findWrappedComponentCallOpen(code, (match.index ?? 0) + match[0].length) !== -1) candidates.push({ name: match[1], index: match.index ?? 0 });
  }
  return [...candidates].toSorted((left, right) => left.index - right.index).at(-1)?.name ?? null;
};
// `export default` is also valid mid-line after a `;` or block-closing `}` (`;export default …`, `if(a){} export default …`); match those
// so the scan does not miss an existing default and append a second one (`Duplicate export of 'default'`).
const hasDefaultExportDeclaration = (code: string) => /(?:^|[\n;}])\s*export\s+default\s+(?:async\s+)?(?:function|class|[A-Za-z_$]|\(|<)/m.test(code) || /(?:^|[\n;}])\s*export\s*\{[^}]*\b(?:as\s+default|default\s*(?:,|}))[^}]*\}/m.test(code);

// React hooks the model commonly forgets to import. Stay conservative: anything outside this set (custom hooks, react-dom hooks like useFormStatus) is left alone.
const REACT_HOOK_NAMES = new Set([
  "useState",
  "useEffect",
  "useRef",
  "useMemo",
  "useCallback",
  "useReducer",
  "useContext",
  "useLayoutEffect",
  "useInsertionEffect",
  "useTransition",
  "useDeferredValue",
  "useId",
  "useImperativeHandle",
  "useDebugValue",
  "useSyncExternalStore",
  "useActionState",
  "useOptimistic",
  "useEffectEvent",
]);

const isUnmaskedImportMatch = (code: string, maskedCode: string, match: RegExpExecArray) => {
  const importIndex = (match.index ?? 0) + match[0].indexOf("import");
  return code.slice(importIndex, importIndex + "import".length) === maskedCode.slice(importIndex, importIndex + "import".length);
};
const collectImportedBindings = (code: string, maskedCode: string) => {
  const bindings = new Set<string>();
  for (const match of code.matchAll(/(?:^|[;\n])\s*import\s+([\s\S]*?)\s+from\s+["'][^"']*["']/g)) {
    if (!isUnmaskedImportMatch(code, maskedCode, match)) continue;
    const clause = match[1].trim();
    if (!clause.startsWith("{") && !clause.startsWith("*")) {
      const defaultMatch = /^([A-Za-z_$][\w$]*)/.exec(clause);
      if (defaultMatch) bindings.add(defaultMatch[1]);
    }
    const namespaceMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespaceMatch) bindings.add(namespaceMatch[1]);
    const namedMatch = /\{([\s\S]*?)\}/.exec(clause);
    if (!namedMatch) continue;
    for (const raw of namedMatch[1].split(",")) {
      const item = raw.trim().replace(/^type\s+/, "");
      if (!item) continue;
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(item);
      if (aliased) {
        // Track both the original name and the alias so `useState as useS` blocks us from re-importing `useState`.
        bindings.add(aliased[1]);
        bindings.add(aliased[2]);
        continue;
      }
      const name = /^([A-Za-z_$][\w$]*)/.exec(item)?.[1];
      if (name) bindings.add(name);
    }
  }
  return bindings;
};

const injectMissingReactHookImports = (code: string, maskedCode: string) => {
  if (!/\buse[A-Z]/.test(maskedCode)) return code;
  const bindings = collectImportedBindings(code, maskedCode);
  const missing = new Set<string>();
  for (const match of maskedCode.matchAll(/\b(use[A-Z][\w$]*)\b/g)) {
    const name = match[1];
    if (!REACT_HOOK_NAMES.has(name) || bindings.has(name)) continue;
    if (maskedCode[(match.index ?? 0) - 1] === ".") continue;
    missing.add(name);
  }
  if (missing.size === 0) return code;
  const additions = [...missing].join(", ");
  // Skips `import type { ... } from "react"` so we don't merge value hooks into a type-only import; supports mixed default+named imports like `import React, { useState } from "react"`.
  const existing = /(?:^|[;\n])\s*import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s+from\s+["']react["']/.exec(code);
  if (existing) {
    if (!isUnmaskedImportMatch(code, maskedCode, existing)) return `import { ${additions} } from "react";\n${code}`;
    const inner = existing[1].trim().replace(/,\s*$/, "");
    const merged = inner ? `${inner}, ${additions}` : additions;
    const rewritten = existing[0].replace(/\{[^}]*\}/, `{ ${merged} }`);
    return `${code.slice(0, existing.index)}${rewritten}${code.slice(existing.index + existing[0].length)}`;
  }
  return `import { ${additions} } from "react";\n${code}`;
};

const isLikelyJsxTagStart = (code: string, index: number) => {
  const next = code[index + 1] ?? "";
  if (!/[A-Za-z/>]/.test(next)) return false;
  let previous = index - 1;
  while (previous >= 0 && /\s/.test(code[previous])) previous -= 1;
  if (previous < 0) return true;
  const previousChar = code[previous];
  if ("([{=:?!,&|^~*/%+-;".includes(previousChar)) return true;
  if (previousChar === ">" && code[previous - 1] === "=") return true;
  if (/[)\]}"'`]/.test(previousChar)) return false;
  if (/[A-Za-z0-9_$]/.test(previousChar)) {
    let word = "";
    for (let cursor = previous; cursor >= 0 && /[A-Za-z0-9_$]/.test(code[cursor]); cursor -= 1) word = code[cursor] + word;
    return new Set(["return", "throw", "await", "yield", "case", "default", "else", "typeof", "void", "delete", "new"]).has(word);
  }
  return previousChar !== ">";
};

const isLikelyStatementBlock = (code: string, index: number) => {
  if (code[index] !== "{") return false;
  const before = code.slice(0, index).trimEnd();
  return /\bfunction(?:\s+[\w$]+)?\s*\([^)]*\)$/.test(before) || /\b(?:if|for|while|switch|catch|with)\s*\([^)]*\)$/.test(before) || /(?:^|[^\w$])(?:else|try|finally|do)$/.test(before) || before.endsWith("=>");
};

const findJsxTagEnd = (code: string, start: number) => {
  const stack: string[] = [];
  let quote: string | null = null;
  for (let index = start + 1; index < code.length; index += 1) {
    const char = code[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char in BLOCK_FOLLOWERS) {
      stack.push(BLOCK_FOLLOWERS[char]);
      continue;
    }
    if (BLOCK_CLOSERS.has(char)) {
      if (stack.at(-1) === char) stack.pop();
      continue;
    }
    if (char === ">" && stack.length === 0) return index;
  }
  return -1;
};
const findJsxAttributeExpressionEnd = (code: string, index: number) => {
  let depth = 1;
  while (index < code.length) {
    if (code[index] === "/" && code[index + 1] === "/") {
      const end = code.indexOf("\n", index + 2);
      index = end === -1 ? code.length : end;
      continue;
    }
    if (code[index] === "/" && code[index + 1] === "*") {
      const close = code.indexOf("*/", index + 2);
      index = close === -1 ? code.length : close + 2;
      continue;
    }
    if (isLikelyRegexLiteralStart(code, index)) {
      index = findRegexLiteralEnd(code, index);
      continue;
    }
    if (code[index] === '"' || code[index] === "'") {
      index = findStringLiteralEnd(code, index);
      continue;
    }
    if (code[index] === "`") {
      index = findTemplateLiteralEnd(code, index);
      continue;
    }
    if (code[index] === "{") depth += 1;
    else if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
};
const completeIncompleteJsxTag = (code: string, start: number) => {
  if (code[start + 1] === "/") return null;
  const tagMatch = /^<\s*([A-Za-z][\w$.-]*)/.exec(code.slice(start));
  if (!tagMatch) return null;
  const [matched, tagName] = tagMatch;
  // Tag name may still be streaming (`inp` may become `input`, `Sur` may become `Surface`); completing now would render the wrong element or throw `Sur is not defined` and remount. Wait for a separator (space/`>`/attr).
  if (start + matched.length >= code.length) return null;
  let index = start;
  let tag = "";
  while (index < code.length) {
    const char = code[index];
    if (char === "`") {
      // A backtick is illegal as a JSX attribute value (`title=`x`` → "JSX value should be either an expression or a quoted JSX text"); template literals are only valid inside `{...}`. Drop the attribute.
      tag = tag.replace(/\s*[\w$:-]+\s*=\s*$/, "");
      index = findTemplateLiteralEnd(code, index);
      continue;
    }
    if (char === '"' || char === "'") {
      const end = findStringLiteralEnd(code, index);
      let literal = code.slice(index, end);
      const closed = literal.length > 1 && literal.endsWith(char);
      // An unterminated string value is safe to close by synthesizing the missing quote — worst case the frame's text is briefly short, never a throw or a wrong binding. Host and component alike.
      if (!closed) {
        // A trailing odd backslash is an incomplete escape (`title="foo\`); synthesizing the quote would make `\"` an escaped quote, leaving the string unterminated. Drop the dangling backslash before closing.
        if (/\\*$/.exec(literal)![0].length % 2) literal = literal.slice(0, -1);
        literal += char;
      }
      tag += literal;
      index = end;
      continue;
    }
    if (char === "{") {
      const expressionEnd = findJsxAttributeExpressionEnd(code, index + 1);
      // An unterminated expression value must not be completed: mid-stream `{x` may still become `x.y`, `xyz`, or `x + 1`, so synthesizing `}` binds the frame to the wrong (or undefined) value and can throw. Drop the attribute, keep the tag. Host and component alike.
      if (expressionEnd === -1) {
        tag = tag.replace(/\s*[\w$:-]+\s*=\s*$/, "");
        index = code.length;
        continue;
      }
      const expression = code.slice(index + 1, expressionEnd);
      const completedExpression = completeIncompleteExpressionPrefix(completePartialTsx(expression), true);
      if (!expression.trim() || !completedExpression.trim() || /^(?:const|let|var)\b/.test(completedExpression.trim())) {
        tag = tag.replace(/\s*[\w$:-]+\s*=\s*$/, "");
        index = expressionEnd + 1;
        continue;
      }
      tag += `{${completedExpression}}`;
      index = expressionEnd + 1;
      continue;
    }
    tag += char;
    index += 1;
    if (char === ">") return { tag: VOID_TAGS.has(tagName) ? tag.replace(/\s*\/?\s*>$/, " />") : tag, tagName };
  }
  // A dangling `prop=` would close as `prop=>` (SWC reads `=>` as an arrow function), breaking the whole module.
  if (/=\s*$/.test(tag)) tag = tag.replace(/\s*[\w$:-]+\s*=\s*$/, "");
  // Otherwise a trailing name with no following space is still streaming (`valu` may become `value`); a trailing space commits it as a boolean attr.
  else if (!/\s$/.test(tag)) tag = tag.replace(/\s+[A-Za-z_$][\w$:-]*$/, "");
  const completedTag = VOID_TAGS.has(tagName) ? `${tag.replace(/\s*\/\s*$/, "")} />` : `${tag}>`;
  return { tag: completedTag, tagName };
};

type PushOutput = (value: string) => void;

const consumeStringLiteral = (code: string, index: number, push: PushOutput) => {
  const quote = code[index];
  push(quote);
  index += 1;
  let closed = false;
  while (index < code.length) {
    const next = code[index];
    if (next === "\\") {
      push(code.slice(index, index + 2));
      index += 2;
      continue;
    }
    push(next);
    index += 1;
    if (next === quote) {
      closed = true;
      break;
    }
  }
  if (!closed) push(quote);
  return index;
};

const closeFrame = (frame: CompletionFrame) => {
  if (frame.type === "jsx") return frame.tag ? `</${frame.tag}>` : "</>";
  return frame.closer;
};

const isExpressionEnd = (value: string) => /(?:<\/[\w$.-]+>|<\/>|\/>|[>`'")\]\w])$/.test(value.trimEnd());
const collectCompletionStackBefore = (code: string, end: number) => {
  const stack: CompletionFrame[] = [];
  for (let index = 0; index < end; index += 1) {
    const char = code[index];
    if (!isInsideJsxText(stack) && char === "/" && code[index + 1] === "/") {
      const newlineIndex = code.indexOf("\n", index + 2);
      index = (newlineIndex === -1 ? end : Math.min(newlineIndex, end)) - 1;
      continue;
    }
    if (!isInsideJsxText(stack) && char === "/" && code[index + 1] === "*") {
      const closeIndex = code.indexOf("*/", index + 2);
      index = (closeIndex === -1 ? end : Math.min(closeIndex + 2, end)) - 1;
      continue;
    }
    if (!isInsideJsxText(stack) && isLikelyRegexLiteralStart(code, index)) {
      index = Math.min(findRegexLiteralEnd(code, index), end) - 1;
      continue;
    }
    if (!isInsideJsxText(stack) && (char === '"' || char === "'")) {
      index = Math.min(findStringLiteralEnd(code, index), end) - 1;
      continue;
    }
    if (!isInsideJsxText(stack) && char === "`") {
      index = Math.min(findTemplateLiteralEnd(code, index), end) - 1;
      continue;
    }
    if (char === "<" && shouldStartJsxTag(code, index, stack)) {
      const closeIndex = findJsxTagEnd(code, index);
      if (closeIndex === -1 || closeIndex >= end) break;
      updateJsxStackForTag(stack, code.slice(index, closeIndex + 1));
      index = closeIndex;
      continue;
    }
    if (char in BLOCK_FOLLOWERS) stack.push({ type: "block", closer: BLOCK_FOLLOWERS[char], statement: isLikelyStatementBlock(code, index) });
    else if (BLOCK_CLOSERS.has(char)) {
      const frame = stack.at(-1);
      if (frame?.type === "block" && frame.closer === char) stack.pop();
    }
  }
  return stack;
};
const endsWithJsxTagHead = (value: string) => {
  const lastOpen = value.lastIndexOf("<");
  if (lastOpen === -1 || !shouldStartJsxTag(value, lastOpen, collectCompletionStackBefore(value, lastOpen))) return false;
  const tail = value.slice(lastOpen);
  return /^<\/?(?:[A-Za-z][\w$.-]*|$)/.test(tail) && findJsxTagEnd(value, lastOpen) === -1;
};
const hasCompleteRegexLiteralEndingAt = (value: string, endIndex: number) => {
  for (let index = 0; index <= endIndex; index += 1) {
    if (value[index] !== "/" || !isLikelyRegexLiteralStart(value, index)) continue;
    const end = findRegexLiteralEnd(value, index);
    if (end === endIndex + 1) return true;
    if (end > index) index = end - 1;
  }
  return false;
};
const dropTrailingOperator = (value: string, pattern: RegExp) => {
  const match = pattern.exec(value);
  if (!match) return value;
  const operator = match[1];
  const operatorIndex = value.indexOf(operator, match.index);
  const before = value.slice(0, match.index).trimEnd();
  if (operator === "=>") return `${before} => null`;
  if (operator === "/" && hasCompleteRegexLiteralEndingAt(value, operatorIndex)) return value;
  if ((operator === ">" || operator === ">=") && endsWithJsxTagHead(before)) return value;
  return value.slice(0, match.index);
};
const dropTrailingIncompleteExpressionOperator = (value: string) => dropTrailingOperator(value, /\s*(>>>=?|>>=?|<<=?|===|!==|=>|\*\*=|\?\?=|&&=|\|\|=|[+\-*/%&|^]=|\?\?|\?\.|\*\*|[=!<>]=?|&&|\|\||[+\-*/%&|^~]|(?<![.\d])\.)\s*$/s);
// Blanks out string/template/regex/comment spans (but not JSX) so angle-bracket counting in `dropTrailingIncompleteStatement`
// only sees real `<`/`>` operators and type arguments, never a literal `<` (`"a<b"`) or a `</div>` closer.
const maskLiteralSpans = (body: string) => {
  let out = "";
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === "/" && body[index + 1] === "/") {
      const end = body.indexOf("\n", index + 2);
      const stop = end === -1 ? body.length : end;
      out += " ".repeat(stop - index);
      index = stop;
    } else if (char === "/" && body[index + 1] === "*") {
      const end = body.indexOf("*/", index + 2);
      const stop = end === -1 ? body.length : end + 2;
      out += " ".repeat(stop - index);
      index = stop;
    } else if (char === '"' || char === "'") {
      const stop = findStringLiteralEnd(body, index);
      out += " ".repeat(stop - index);
      index = stop;
    } else if (char === "`") {
      const stop = findTemplateLiteralEnd(body, index);
      out += " ".repeat(stop - index);
      index = stop;
    } else if (isLikelyRegexLiteralStart(body, index)) {
      const stop = findRegexLiteralEnd(body, index);
      out += " ".repeat(stop - index);
      index = stop;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
};
// Blank out operators that share the `<` glyph so the angle-bracket counter never mistakes them for type brackets: `=>` (arrow,
// whose `>` would otherwise close a generic early in `useCallback<(x) => void`), `<<`/`<<=` (left-shift, whose `<`s would read as
// phantom openers in `1 << 2`), and `<=` (a `<` that can't open a generic, sparing `a <= b`). `>>`/`>>>`/`>=` are left alone so
// nested generic closers (`Map<K, Array<V>>`) still count.
const neutralizeAngleOperators = (masked: string) => masked.replace(/=>|<<=?|<=/g, (op) => " ".repeat(op.length));
// True when the masked body has a `<` that never closes AND sits in value position (after an identifier / `)` / `]`) with no
// bracket past it that would close out the surrounding expression — i.e. a type-argument list whose `>` hasn't streamed yet
// (`useState<number | null`). Excludes a `<` right after `=` (a generic-arrow `<T,>(x)=>x`, completed elsewhere) and any `<`
// followed by a `)`/`]`/`}` that ends the initializer (`items.filter((i) => i < 3)` — a real comparison, already terminated).
const hasUnclosedTypeArgument = (body: string) => {
  const masked = neutralizeAngleOperators(body);
  let depth = 0;
  let firstUnclosed = -1;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "<") {
      if (depth === 0) firstUnclosed = index;
      depth += 1;
    } else if (char === ">") {
      if (depth > 0) depth -= 1;
      if (depth === 0) firstUnclosed = -1;
    }
  }
  if (firstUnclosed < 0) return false;
  if (!/[\w$)\]]$/.test(masked.slice(0, firstUnclosed).trimEnd())) return false;
  let bracketDepth = 0;
  for (let index = firstUnclosed + 1; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "(" || char === "[" || char === "{") bracketDepth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      bracketDepth -= 1;
      if (bracketDepth < 0) return false;
    }
  }
  return true;
};
// Locate the last `const`/`let`/`var` whose declaration runs to EOF without a depth-0 `;` terminator, scanning the
// literal-masked text so a `;`/`{`/`<` sitting inside a string or comment (`const s = "a; const x = useState<T"`) is never
// mistaken for a statement boundary. A declaration can begin at the buffer start or right after `{`, `}`, `;`, or `=>`; we keep
// the latest one that isn't closed by a depth-0 `;` or by a `)`/`]`/`}` that pops out of its enclosing block.
const locateTrailingDeclaration = (value: string) => {
  const masked = maskLiteralSpans(value);
  const re = /(?:^|[{};\n]|=>)\s*(const|let|var)\b/g;
  let match: RegExpExecArray | null;
  let start = -1;
  let kind = "";
  while ((match = re.exec(masked))) {
    const declarationStart = match.index + match[0].length - match[1].length;
    let depth = 0;
    let terminated = false;
    for (let index = declarationStart + match[1].length; index < masked.length; index += 1) {
      const char = masked[index];
      if (char === "(" || char === "[" || char === "{") depth += 1;
      else if (char === ")" || char === "]" || char === "}") {
        if (depth === 0) {
          terminated = true;
          break;
        }
        depth -= 1;
      } else if (char === ";" && depth === 0) {
        terminated = true;
        break;
      }
    }
    if (!terminated) {
      start = declarationStart;
      kind = match[1];
    }
  }
  return start === -1 ? null : { start, kind, body: value.slice(start + kind.length) };
};
const dropTrailingIncompleteStatement = (value: string) => {
  const declaration = locateTrailingDeclaration(value);
  if (!declaration) return value;
  const { start, kind, body } = declaration;
  // Net bracket depth of the initializer: a trailing `=` only truncates the declaration's own initializer when we're
  // back at top level. Inside an already-open arrow/function body (`() => { ...; x =`) the `=` belongs to a nested
  // statement the block-frame completer will close, so rolling back the whole declaration would over-strip and over-close.
  let initializerDepth = 0;
  for (const char of maskLiteralSpans(body)) {
    if (char === "(" || char === "[" || char === "{") initializerDepth += 1;
    else if (char === ")" || char === "]" || char === "}") initializerDepth -= 1;
  }
  const incompleteInitializer = initializerDepth <= 0 && /=\s*$/.test(body);
  // An initializer truncated mid-generic (`useState<number | null`) is valid-looking JS where SWC reads `<` as a comparison
  // and keeps `number` as a bare value reference, crashing at runtime; drop the statement until its `>` closer streams in.
  const unclosedGenericInitializer = body.includes("=") && hasUnclosedTypeArgument(maskLiteralSpans(body));
  const missingDeclaration = !body.trim() || (!body.includes("=") && (kind === "const" || /^[\s,]*(?:\[|\{)/.test(body)));
  if (!incompleteInitializer && !missingDeclaration && !unclosedGenericInitializer) return value;
  return value.slice(0, start);
};
const completeTrailingIncompleteTernary = (value: string) => {
  const masked = maskIgnoredTextForExportScan(value);
  if (/(?<!\?)\?(?![.?])[^?;{}]*:\s*$/s.test(masked)) return `${value} null`;
  const match = /(?<!\?)\?(?![.?])(?<tail>[^?:;{}]*)$/s.exec(masked);
  if (!match?.groups) return value;
  return value.slice(match.index + 1).trim() ? `${value} : null` : `${value} null : null`;
};
// A second `function` declaration that has only streamed up to its keyword/name (no parameter list yet) leaves a dangling
// `function`/`function Name` that SWC rejects with `Expected ident`/`Expected '('`, blanking the already-rendered prior
// declaration. Drop it back to the preceding complete statement until its `(` arrives.
const dropTrailingIncompleteFunctionDeclaration = (value: string) => {
  const match = /(?:^|[}\n;])\s*((?:export\s+(?:default\s+)?)?(?:async\s+)?function\b\s*\*?\s*[A-Za-z_$]?[\w$]*\s*)$/.exec(value);
  return match ? value.slice(0, match.index + (match[0].length - match[1].length)) : value;
};
const completeIncompleteExpressionPrefix = (value: string, dropStatement = false) => completeTrailingIncompleteTernary(dropTrailingIncompleteExpressionOperator(dropStatement ? dropTrailingIncompleteFunctionDeclaration(dropTrailingIncompleteStatement(value)) : value));
const fillEmptyReturnExpression = (value: string) => {
  if (/\breturn\s*$/.test(value)) return `${value} null`;
  return value.replace(/(\breturn\s*\(\s*)\)$/s, "$1null)");
};
// A non-statement bracket frame gets its expression prefix completed (and possibly dropped). Completing can shorten the output
// two different ways: a trailing operator/dot trim (the frame's own `{`/`[` survives, so we still close it) or a whole-declaration
// rollback that removes the frame's own opening bracket plus every nested opener — e.g. `useState<{ nested: { count` or an array
// initializer `[{ foo: useState<number`. We tell them apart with `frame.open` (the opener's offset): if the completed text no
// longer reaches that offset, the opener is gone, so we emit no closer and report `dropped` for the caller to skip orphaned
// inner frames whose openers were inside the rolled-back span.
const completeBlockFrame = (output: string, frame: Extract<CompletionFrame, { type: "block" }>) => {
  if (frame.statement) return { text: `${output}${frame.closer}`, dropped: false };
  const completed = completeIncompleteExpressionPrefix(output, true);
  const openerGone = frame.open !== undefined ? completed.length <= frame.open : completed.length < output.length;
  if (openerGone) return { text: completed, dropped: true };
  return { text: `${completed}${frame.closer}`, dropped: false };
};
// An empty `(` is a legal empty argument list only when it directly follows a callee; as a grouping or
// arrow body it must hold an expression, so fill `null` rather than closing into an illegal empty `()`.
const isCallArgumentParen = (value: string) => /(?:[\w$)\]]|\?\.)$/.test(value.slice(0, -1).trimEnd());
const completeStatementPrefixFrame = (output: string, frame: CompletionFrame): { text: string; dropped: boolean } => {
  if (frame.type !== "block") return { text: `${output}${closeFrame(frame)}`, dropped: false };
  if (frame.closer === ")") {
    const completed = completeIncompleteExpressionPrefix(output);
    return { text: `${completed.endsWith("(") && !isCallArgumentParen(completed) ? `${completed}null` : completed}${frame.closer}`, dropped: false };
  }
  return completeBlockFrame(output, frame);
};
// Close frames from the stack top down. A frame whose own opening bracket was rolled back by a declaration drop must not emit a
// closer — `completeBlockFrame` detects that and reports `open: number` for the bracket position it would have closed, so once
// a drop happens we know which later frames lost their opener (those whose recorded bracket offset is past the drop point).
const closeStackFrames = (output: string, frames: CompletionFrame[]) => {
  let text = output;
  let dropPoint = Infinity;
  for (const frame of frames) {
    if (frame.type === "block" && frame.open !== undefined && frame.open >= dropPoint) continue;
    const result = completeStatementPrefixFrame(text, frame);
    if (result.dropped) dropPoint = Math.min(dropPoint, result.text.length);
    text = result.text;
  }
  return text;
};
const REGEX_PREFIX_WORDS = new Set(["return", "throw", "case", "delete", "typeof", "void", "new", "in", "of", "await", "yield"]);
const JSX_CLOSING_TAG_START = /^<\/\s*(?:[A-Za-z][\w$.-]*\s*)?>/;

function isLikelyRegexLiteralStart(code: string, index: number) {
  if (code[index] !== "/" || code[index + 1] === "/" || code[index + 1] === "*") return false;
  if (code[index - 1] === "<" && JSX_CLOSING_TAG_START.test(code.slice(index - 1))) return false;
  let previous = index - 1;
  while (previous >= 0 && /\s/.test(code[previous])) previous -= 1;
  if (previous < 0) return true;
  const previousChar = code[previous];
  if ("([{=,:;!&|?+-*~^<>".includes(previousChar)) return true;
  if (!/[A-Za-z_$]/.test(previousChar)) return false;
  let word = "";
  for (let cursor = previous; cursor >= 0 && /[A-Za-z0-9_$]/.test(code[cursor]); cursor -= 1) word = code[cursor] + word;
  return REGEX_PREFIX_WORDS.has(word);
}

function findRegexLiteralEnd(code: string, index: number) {
  index += 1;
  let inClass = false;
  while (index < code.length) {
    const next = code[index];
    if (next === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (next === "[" && !inClass) inClass = true;
    else if (next === "]" && inClass) inClass = false;
    else if (next === "/" && !inClass) {
      while (index < code.length && /[A-Za-z]/.test(code[index])) index += 1;
      return index;
    }
  }
  return code.length;
}

const consumeRegexLiteral = (code: string, index: number, push: PushOutput) => {
  push("/");
  index += 1;
  let inClass = false;
  let closed = false;
  while (index < code.length) {
    const next = code[index];
    if (next === "\\") {
      push(code.slice(index, index + 2));
      index += 2;
      continue;
    }
    push(next);
    index += 1;
    if (next === "[" && !inClass) inClass = true;
    else if (next === "]" && inClass) inClass = false;
    else if (next === "/" && !inClass) {
      closed = true;
      break;
    }
  }
  while (closed && index < code.length && /[A-Za-z]/.test(code[index])) {
    push(code[index]);
    index += 1;
  }
  if (!closed) push("/");
  return index;
};

const isJsxTagHead = (code: string, index: number) => {
  const tail = code.slice(index);
  if (tail.startsWith("<>") || tail.startsWith("</>") || tail === "</") return true;
  if (tail.startsWith("</")) return /^<\/\s*[A-Za-z][\w$.-]*(?:\s*>|>|$)/.test(tail);
  const match = /^<[A-Za-z][\w$.-]*/.exec(tail);
  return match !== null && /^(?:$|[\s/>])/.test(tail.slice(match[0].length));
};

// A comma right after the tag name (`<T,`) is a TSX generic type-param list, not JSX — a JSX tag name is only ever
// followed by whitespace, `/`, `>`, or end, never a bare comma. Without this, the generic arrow `<T,>(x:T)=>x` is
// misread as an open `<T>` element and a synthetic `</T>` is appended, breaking the module.
const isGenericTypeParamList = (code: string, index: number) => /^<\s*[A-Za-z_$][\w$]*\s*,/.test(code.slice(index));
const shouldStartJsxTag = (code: string, index: number, stack: CompletionFrame[]) => {
  if (isGenericTypeParamList(code, index)) return false;
  if (stack.at(-1)?.type === "jsx") return isJsxTagHead(code, index);
  return isLikelyJsxTagStart(code, index);
};
const isInsideJsxText = (stack: CompletionFrame[]) => stack.at(-1)?.type === "jsx";

const consumeTemplateExpression = (code: string, index: number, push: PushOutput): number => {
  let depth = 1;
  while (index < code.length && depth > 0) {
    const expressionChar = code[index];
    if (expressionChar === "/" && code[index + 1] === "/") {
      const newlineIndex = code.indexOf("\n", index + 2);
      const end = newlineIndex === -1 ? code.length : newlineIndex;
      push(code.slice(index, end));
      index = end;
      continue;
    }
    if (expressionChar === "/" && code[index + 1] === "*") {
      const closeIndex = code.indexOf("*/", index + 2);
      if (closeIndex === -1) {
        push(`${code.slice(index)}*/`);
        return code.length;
      }
      push(code.slice(index, closeIndex + 2));
      index = closeIndex + 2;
      continue;
    }
    if (isLikelyRegexLiteralStart(code, index)) {
      index = consumeRegexLiteral(code, index, push);
      continue;
    }
    if (expressionChar === '"' || expressionChar === "'") {
      index = consumeStringLiteral(code, index, push);
      continue;
    }
    if (expressionChar === "`") {
      index = consumeTemplateLiteral(code, index, push);
      continue;
    }
    push(expressionChar);
    index += 1;
    if (expressionChar === "{") depth += 1;
    else if (expressionChar === "}") depth -= 1;
  }
  if (depth > 0) push("}".repeat(depth));
  return index;
};

const consumeTemplateLiteral = (code: string, index: number, push: PushOutput): number => {
  push("`");
  index += 1;
  let closed = false;
  while (index < code.length) {
    const next = code[index];
    if (next === "\\") {
      push(code.slice(index, index + 2));
      index += 2;
      continue;
    }
    if (next === "$" && code[index + 1] === "{") {
      push("${");
      index = consumeTemplateExpression(code, index + 2, push);
      continue;
    }
    push(next);
    index += 1;
    if (next === "`") {
      closed = true;
      break;
    }
  }
  if (!closed) push("`");
  return index;
};

export function completePartialTsx(code: string) {
  let output = "";
  const stack: CompletionFrame[] = [];
  let index = 0;
  let validEnd = code.length;
  const push = (value: string) => {
    output += value;
  };
  while (index < code.length) {
    const char = code[index];
    if (!isInsideJsxText(stack) && char === "/" && code[index + 1] === "/") {
      const newlineIndex = code.indexOf("\n", index + 2);
      const end = newlineIndex === -1 ? code.length : newlineIndex;
      push(code.slice(index, end));
      index = end;
      continue;
    }
    if (!isInsideJsxText(stack) && char === "/" && code[index + 1] === "*") {
      const closeIndex = code.indexOf("*/", index + 2);
      if (closeIndex === -1) {
        push(`${code.slice(index)}*/`);
        index = code.length;
        continue;
      }
      push(code.slice(index, closeIndex + 2));
      index = closeIndex + 2;
      continue;
    }
    if (!isInsideJsxText(stack) && isLikelyRegexLiteralStart(code, index)) {
      index = consumeRegexLiteral(code, index, push);
      continue;
    }
    if (!isInsideJsxText(stack) && (char === '"' || char === "'")) {
      index = consumeStringLiteral(code, index, push);
      continue;
    }
    if (!isInsideJsxText(stack) && char === "`") {
      index = consumeTemplateLiteral(code, index, push);
      continue;
    }
    if (char === "<" && isInsideJsxText(stack) && !shouldStartJsxTag(code, index, stack) && index < code.length - 1) {
      push("&lt;");
      index += 1;
      continue;
    }
    if (char === "<" && !shouldStartJsxTag(code, index, stack) && index === code.length - 1) {
      const frame = stack.at(-1);
      if (frame?.type === "block" && frame.closer === "}" && !frame.statement) output = output.trimEnd();
      break;
    }
    if (char === "<" && shouldStartJsxTag(code, index, stack)) {
      const closeIndex = findJsxTagEnd(code, index);
      if (closeIndex === -1) {
        const completedTag = completeIncompleteJsxTag(code, index);
        if (completedTag === null) {
          validEnd = index;
          output = output.slice(0, validEnd);
          break;
        }
        push(completedTag.tag);
        index = code.length;
        if (!completedTag.tag.trimEnd().endsWith("/>") && !VOID_TAGS.has(completedTag.tagName)) stack.push({ type: "jsx", tag: completedTag.tagName });
        break;
      }
      const tag = code.slice(index, closeIndex + 1);
      const match = /^<\/?\s*([A-Za-z][\w$.-]*)/.exec(tag);
      const tagName = match?.[1] ?? (tag === "<>" || tag === "</>" ? "" : null);
      if (!(tagName && VOID_TAGS.has(tagName) && tag.startsWith("</"))) push(tagName && VOID_TAGS.has(tagName) && !tag.endsWith("/>") ? tag.replace(/\s*\/?\s*>$/, " />") : tag);
      index = closeIndex + 1;
      updateJsxStackForTag(stack, tag);
      continue;
    }
    if (char in BLOCK_FOLLOWERS) {
      stack.push({ type: "block", closer: BLOCK_FOLLOWERS[char], statement: isLikelyStatementBlock(code, index), open: output.length });
      push(char);
      index += 1;
      continue;
    }
    if (BLOCK_CLOSERS.has(char)) {
      const frame = stack.at(-1);
      if (frame?.type === "block" && frame.closer === char) stack.pop();
      push(char);
      index += 1;
      continue;
    }
    push(char);
    index += 1;
  }
  const closingFrames = [...stack].toReversed();
  const closers = closingFrames.map(closeFrame).join("");
  if (!closers) return completeIncompleteExpressionPrefix(output, true);
  const statementIndex = closingFrames.findIndex((frame) => frame.type === "block" && frame.statement);
  if (statementIndex === -1) return closeStackFrames(output, closingFrames);
  const beforeStatement = closeStackFrames(output, closingFrames.slice(0, statementIndex));
  const completedExpression = fillEmptyReturnExpression(completeIncompleteExpressionPrefix(beforeStatement, true));
  return `${completedExpression}${isExpressionEnd(completedExpression) ? ";" : ""}${closingFrames.slice(statementIndex).map(closeFrame).join("")}`;
}

export function normalizeGeneratedTsx(code: string) {
  let next = completePartialTsx(stripMarkdownFence(code)).trim();
  const exportScanCode = maskIgnoredTextForExportScan(next);
  if (!hasDefaultExportDeclaration(exportScanCode)) {
    const componentName = findLastExportableComponent(exportScanCode);
    if (componentName) next += `\nexport default ${componentName};`;
  }
  next = injectMissingReactHookImports(next, exportScanCode);
  return next;
}
