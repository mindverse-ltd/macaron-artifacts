// A tiny hand-rolled TSX lexer that extracts the ordered list of React hook calls from generated source. The renderer compares
// successive signatures: same layout keeps preserved state, a changed layout remounts the stable boundary so React reassigns hook cells.
const identifierPartPattern = /[\w$]/;
const hookCallPattern = /use[A-Z][\w$]*/y;
const regexPrefixKeywords = new Set(["return", "throw", "case", "delete", "void", "typeof", "yield", "await", "in", "of"]);
const jsxPrefixKeywords = new Set(["return", "throw", "case", "yield", "await"]);
const skipQuotedString = (code: string, index: number) => {
  const quote = code[index];
  index += 1;
  while (index < code.length) {
    if (code[index] === "\\") index += 2;
    else if (code[index] === quote) return index + 1;
    else index += 1;
  }
  return code.length;
};
const skipLineComment = (code: string, index: number) => {
  const end = code.indexOf("\n", index + 2);
  return end === -1 ? code.length : end;
};
const skipBlockComment = (code: string, index: number) => {
  const end = code.indexOf("*/", index + 2);
  return end === -1 ? code.length : end + 2;
};
const isRegexLiteralStart = (code: string, index: number) => {
  const previous = previousNonSpaceIndex(code, index);
  if (previous < 0) return true;
  if ("([{=,:;!&|?+-*~^<>".includes(code[previous])) return true;
  if (!identifierPartPattern.test(code[previous])) return false;
  let word = "";
  for (let cursor = previous; cursor >= 0 && identifierPartPattern.test(code[cursor]); cursor -= 1) word = code[cursor] + word;
  return regexPrefixKeywords.has(word);
};
const skipRegexLiteral = (code: string, index: number) => {
  index += 1;
  let inClass = false;
  while (index < code.length) {
    const char = code[index];
    if (char === "\\") index += 2;
    else if (char === "[") {
      inClass = true;
      index += 1;
    } else if (char === "]") {
      inClass = false;
      index += 1;
    } else if (char === "/" && !inClass) {
      index += 1;
      while (/[A-Za-z]/.test(code[index] ?? "")) index += 1;
      return index;
    } else index += 1;
  }
  return code.length;
};
type HookSignatureContext = { localHookNames: Set<string>; reactNamespaces: Set<string> };
const previousNonSpaceIndex = (code: string, index: number) => {
  let previous = index - 1;
  while (previous >= 0 && /\s/.test(code[previous])) previous -= 1;
  return previous;
};
const readIdentifierEndingBefore = (code: string, index: number) => {
  let end = index;
  while (end > 0 && /\s/.test(code[end - 1] ?? "")) end -= 1;
  let start = end;
  while (start > 0 && identifierPartPattern.test(code[start - 1] ?? "")) start -= 1;
  return start === end ? null : { name: code.slice(start, end), start };
};
const readMemberNamespaceBefore = (code: string, index: number) => {
  const dot = previousNonSpaceIndex(code, index);
  if (dot < 0 || code[dot] !== ".") return null;
  const namespace = readIdentifierEndingBefore(code, code[dot - 1] === "?" ? dot - 1 : dot);
  if (!namespace) return "";
  const previous = previousNonSpaceIndex(code, namespace.start);
  if (previous >= 0 && (identifierPartPattern.test(code[previous]) || ".)]}".includes(code[previous]))) return "";
  return namespace.name;
};
const skipHookTypeArguments = (code: string, index: number) => {
  if (code[index] !== "<") return index;
  let depth = 0;
  while (index < code.length) {
    const char = code[index];
    if (char === '"' || char === "'") index = skipQuotedString(code, index);
    else if (char === "/" && code[index + 1] === "/") index = skipLineComment(code, index);
    else if (char === "/" && code[index + 1] === "*") index = skipBlockComment(code, index);
    else if (char === "<") {
      depth += 1;
      index += 1;
    } else if (char === ">" && code[index - 1] === "=") index += 1;
    else if (char === ">") {
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
    } else index += 1;
  }
  return -1;
};
const isFunctionDeclarationName = (code: string, index: number) => /\bfunction\s*\*?\s*$/.test(code.slice(0, index).trimEnd());
const collectReactHookNamespaces = (code: string) => {
  const namespaces = new Set(["React", "react"]);
  for (const match of code.matchAll(/(?:^|[;\n])\s*import\s+((?:(?![;\n]\s*import\b)[\s\S])*?)\s+from\s+["']react["']/g)) {
    const clause = match[1].trim();
    if (/^type\b/.test(clause)) continue;
    if (!clause.startsWith("{") && !clause.startsWith("*")) {
      const defaultMatch = /^([A-Za-z_$][\w$]*)/.exec(clause);
      if (defaultMatch) namespaces.add(defaultMatch[1]);
    }
    const namespaceMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespaceMatch) namespaces.add(namespaceMatch[1]);
  }
  return namespaces;
};
const collectLocalHookNames = (code: string) => {
  const names = new Set<string>();
  for (const match of code.matchAll(/\bfunction\s*\*?\s+(use[A-Z][\w$]*)\s*\(/g)) names.add(match[1]);
  for (const match of code.matchAll(/\b(?:const|let|var)\s+(use[A-Z][\w$]*)\s*=/g)) names.add(match[1]);
  return names;
};
const readHookCall = (code: string, index: number, context: HookSignatureContext) => {
  hookCallPattern.lastIndex = index;
  const match = hookCallPattern.exec(code);
  if (!match || match.index !== index) return null;
  const hookName = match[0];
  const namespace = readMemberNamespaceBefore(code, index);
  if (namespace !== null) {
    if (!context.reactNamespaces.has(namespace)) return null;
  } else {
    if (identifierPartPattern.test(code[index - 1] ?? "")) return null;
    if (isFunctionDeclarationName(code, index)) return null;
  }
  let end = index + hookName.length;
  while (/\s/.test(code[end] ?? "")) end += 1;
  if (code[end] === "<") {
    end = skipHookTypeArguments(code, end);
    if (end === -1) return null;
    while (/\s/.test(code[end] ?? "")) end += 1;
  }
  if (code[end] !== "(") return null;
  return { name: context.localHookNames.has(hookName) ? "useCustomHook" : hookName, end: end + 1 };
};
const shouldStartJsxTag = (code: string, index: number) => {
  if (!/[A-Za-z>]/.test(code[index + 1] ?? "")) return false;
  const previous = previousNonSpaceIndex(code, index);
  if (previous < 0 || "([{=,:;!?&|+-*~^<>".includes(code[previous])) return true;
  if (!identifierPartPattern.test(code[previous])) return false;
  let word = "";
  for (let cursor = previous; cursor >= 0 && identifierPartPattern.test(code[cursor]); cursor -= 1) word = code[cursor] + word;
  return jsxPrefixKeywords.has(word);
};
const scanHookSignatureJs = (code: string, hooks: string[], context: HookSignatureContext, start = 0, end = code.length): number => {
  for (let index = start; index < end; ) {
    const char = code[index];
    if (char === "/" && code[index + 1] === "/") index = skipLineComment(code, index);
    else if (char === "/" && code[index + 1] === "*") index = skipBlockComment(code, index);
    else if (char === '"' || char === "'") index = skipQuotedString(code, index);
    else if (char === "`") index = scanHookSignatureTemplate(code, hooks, context, index);
    else if (char === "/" && isRegexLiteralStart(code, index)) index = skipRegexLiteral(code, index);
    else if (char === "<" && shouldStartJsxTag(code, index)) index = scanHookSignatureJsx(code, hooks, context, index);
    else {
      const hook = readHookCall(code, index, context);
      if (hook) {
        hooks.push(hook.name);
        index = hook.end;
      } else index += 1;
    }
  }
  return end;
};
const scanHookSignatureTemplate = (code: string, hooks: string[], context: HookSignatureContext, index: number) => {
  index += 1;
  while (index < code.length) {
    if (code[index] === "\\") index += 2;
    else if (code[index] === "`") return index + 1;
    else if (code[index] === "$" && code[index + 1] === "{") index = scanHookSignatureBraces(code, hooks, context, index + 1);
    else index += 1;
  }
  return code.length;
};
const scanHookSignatureBraces = (code: string, hooks: string[], context: HookSignatureContext, index: number) => {
  let depth = 1;
  index += 1;
  while (index < code.length) {
    const char = code[index];
    if (char === "/" && code[index + 1] === "/") index = skipLineComment(code, index);
    else if (char === "/" && code[index + 1] === "*") index = skipBlockComment(code, index);
    else if (char === '"' || char === "'") index = skipQuotedString(code, index);
    else if (char === "`") index = scanHookSignatureTemplate(code, hooks, context, index);
    else if (char === "/" && isRegexLiteralStart(code, index)) index = skipRegexLiteral(code, index);
    else if (char === "<" && shouldStartJsxTag(code, index)) index = scanHookSignatureJsx(code, hooks, context, index);
    else if (char === "{") {
      depth += 1;
      index += 1;
    } else if (char === "}") {
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
    } else {
      const hook = readHookCall(code, index, context);
      if (hook) {
        hooks.push(hook.name);
        index = hook.end;
      } else index += 1;
    }
  }
  return code.length;
};
const scanJsxOpeningTag = (code: string, hooks: string[], context: HookSignatureContext, index: number) => {
  while (index < code.length) {
    const char = code[index];
    if (char === "`") index = scanHookSignatureTemplate(code, hooks, context, index);
    else if (char === '"' || char === "'") index = skipQuotedString(code, index);
    else if (char === "{") index = scanHookSignatureBraces(code, hooks, context, index);
    else if (char === ">") {
      const previous = previousNonSpaceIndex(code, index);
      return { index: index + 1, selfClosing: code[previous] === "/" };
    } else index += 1;
  }
  return { index: code.length, selfClosing: true };
};
const scanHookSignatureJsx = (code: string, hooks: string[], context: HookSignatureContext, index: number): number => {
  let depth = 0;
  while (index < code.length) {
    if (code.startsWith("</>", index)) {
      index += 3;
      depth -= 1;
      if (depth <= 0) return index;
    } else if (code.startsWith("</", index)) {
      const close = code.indexOf(">", index + 2);
      index = close === -1 ? code.length : close + 1;
      depth -= 1;
      if (depth <= 0) return index;
    } else if (code.startsWith("<>", index)) {
      depth += 1;
      index += 2;
    } else if (code[index] === "<" && /[A-Za-z]/.test(code[index + 1] ?? "")) {
      const opened = scanJsxOpeningTag(code, hooks, context, index + 1);
      index = opened.index;
      if (!opened.selfClosing) depth += 1;
      else if (depth <= 0) return index;
    } else if (code[index] === "{") index = scanHookSignatureBraces(code, hooks, context, index);
    else index += 1;
  }
  return code.length;
};
export const getGenUIHookSignature = (code: string) => {
  const hooks: string[] = [];
  scanHookSignatureJs(code, hooks, { localHookNames: collectLocalHookNames(code), reactNamespaces: collectReactHookNamespaces(code) });
  return hooks.join("\n");
};
