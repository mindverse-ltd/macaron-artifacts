import { parse } from 'shell-quote';

export type CommandActivity = { kind: 'read' | 'search' | 'list'; target: string; path?: string };

const searchFlags = new Set('--heading --no-heading --line-number --no-line-number --hidden --no-ignore --no-ignore-vcs --follow --ignore-case --smart-case --case-sensitive --fixed-strings --word-regexp --line-regexp --only-matching --files-with-matches --files-without-match --count --count-matches --column --with-filename --no-filename --multiline --multiline-dotall --files'.split(' '));
const searchValues = new Set('-g --glob --iglob -t --type -T --type-not -m --max-count --max-depth --max-filesize -A --after-context -B --before-context -C --context --color -e --regexp'.split(' '));
const grepFlags = new Set('--line-number --ignore-case --fixed-strings --word-regexp --line-regexp --only-matching --files-with-matches --files-without-match --count --with-filename --no-filename --recursive --extended-regexp'.split(' '));
const grepValues = new Set('-m --max-count -A --after-context -B --before-context -C --context --include --exclude --exclude-dir --color -e --regexp'.split(' '));
const listFlags = new Set('--hidden --no-ignore --full-path --glob --fixed-strings --case-sensitive --ignore-case --absolute-path'.split(' '));
const lsFlags = new Set('--all --almost-all --directory --recursive --human-readable'.split(' '));
const listValues = new Set('-d --max-depth --min-depth -t --type -e --extension -E --exclude'.split(' '));
const readFlags = new Set('--quiet --silent --verbose'.split(' '));
const catFlags = new Set('--number --number-nonblank --squeeze-blank --show-all --show-ends --show-tabs --show-nonprinting'.split(' '));
const readValues = new Set('-n --lines -c --bytes'.split(' '));
const numericValues = new Set('-n --lines -c --bytes -m --max-count -d --max-depth --min-depth -A --after-context -B --before-context -C --context'.split(' '));

function argumentsOf(args: string[], flags: Set<string>, values: Set<string>, shortFlags: RegExp) {
  const positional: string[] = [], patterns: string[] = [];
  let ended = false, files = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!ended && arg === '--') { ended = true; continue; }
    if (ended || !arg.startsWith('-')) { positional.push(arg); continue; }
    const equals = arg.indexOf('='), option = equals > 0 ? arg.slice(0, equals) : arg;
    const attached = !arg.startsWith('--') && arg.length > 2 && values.has(arg.slice(0, 2));
    const valueOption = attached ? arg.slice(0, 2) : option;
    if (values.has(valueOption)) {
      const value = attached ? arg.slice(2) : equals > 0 ? arg.slice(equals + 1) : args[++index];
      if (value === undefined || value === '') return;
      if (numericValues.has(valueOption) && !/^[+-]?\d+$/.test(value)) return;
      if (valueOption === '-e' || valueOption === '--regexp') patterns.push(value);
    } else if (equals < 0 && (flags.has(arg) || shortFlags.test(arg))) {
      files ||= arg === '--files';
    } else return;
  }
  return { positional, patterns, files };
}

function commandActivities(words: string[], depth: number): CommandActivity[] | undefined {
  const executable = words[0]?.replace(/^\/(?:usr\/)?bin\//, '');
  const args = words.slice(1);
  if (['sh', 'bash', 'zsh'].includes(executable) && args.length === 2 && ['-c', '-lc'].includes(args[0])) return parseCommand(args[1], depth + 1);
  if (executable === 'sed') {
    const files = args.slice(2).filter((value, index) => index !== 0 || value !== '--');
    return args[0] === '-n' && /^\d+(?:,\d+)?p$/.test(args[1] ?? '') && files.length && files.every(file => file && !file.startsWith('-'))
      ? files.map(target => ({ kind: 'read', target })) : undefined;
  }
  if (['cat', 'head', 'tail'].includes(executable)) {
    const parsed = argumentsOf(args, executable === 'cat' ? catFlags : readFlags, executable === 'cat' ? new Set() : readValues, executable === 'cat' ? /^-[benstuvAET]+$/ : /^-[qv]+$/);
    if (!parsed?.positional.length || parsed.positional.some(file => !file || file === '-')) return;
    return parsed.positional.map(target => ({ kind: 'read', target }));
  }
  if (executable === 'rg' || executable === 'grep') {
    const parsed = argumentsOf(args, executable === 'rg' ? searchFlags : grepFlags, executable === 'rg' ? searchValues : grepValues, executable === 'rg' ? /^-[niSsFwxolLcHhU]+$/ : /^-[nirsREFwxolLcHh]+$/);
    if (!parsed) return;
    if (parsed.files) return executable === 'rg' && !parsed.patterns.length ? (parsed.positional.length ? parsed.positional : ['.']).map(target => ({ kind: 'list', target })) : undefined;
    const targets = parsed.patterns.length ? parsed.patterns : [parsed.positional.shift()];
    if (targets.some(target => !target)) return;
    return targets.flatMap(target => parsed.positional.length ? parsed.positional.map(path => ({ kind: 'search' as const, target: target!, path })) : [{ kind: 'search' as const, target: target! }]);
  }
  if (executable === 'ls' || executable === 'fd') {
    const parsed = argumentsOf(args, executable === 'fd' ? listFlags : lsFlags, executable === 'fd' ? listValues : new Set(), executable === 'fd' ? /^-[HIpgiFsa]+$/ : /^-[aAlhdR1FptSris]+$/);
    if (!parsed) return;
    if (executable === 'ls' || !parsed.positional.length) return (parsed.positional.length ? parsed.positional : ['.']).map(target => ({ kind: 'list', target }));
    const [target, ...paths] = parsed.positional;
    return (paths.length ? paths : [undefined]).map(path => ({ kind: 'search', target, ...(path ? { path } : {}) }));
  }
}

function parseCommand(command: string, depth: number): CommandActivity[] | undefined {
  // shell-quote tolerates unfinished quotes. Reject those and expansion syntax before interpreting its tokens for display.
  if (depth > 2 || command.length > 20_000 || ['`', '\r', '\n', '\0'].some(character => command.includes(character)) || command.includes('$(') || !/^(?:[^\\'"\n]|\\[^\n]|'[^']*'|"(?:[^"\\]|\\.)*")*$/.test(command)) return;
  try {
    const tokens = parse(command, () => { throw new Error('Unresolved shell variable'); });
    const segments: string[][] = [[]];
    for (const token of tokens) {
      if (typeof token === 'string') segments[segments.length - 1].push(token);
      else if ('op' in token && (token.op === '&&' || token.op === ';') && segments[segments.length - 1].length) segments.push([]);
      else return;
    }
    const activities: CommandActivity[] = [];
    for (const segment of segments) {
      const parsed = commandActivities(segment, depth);
      if (!parsed?.length) return;
      activities.push(...parsed);
      if (activities.length > 32) return;
    }
    return activities.length ? activities : undefined;
  } catch { return; }
}

/** A conservative description fallback, never an execution or permission classifier. */
export function parseCommandActivities(command: unknown): CommandActivity[] | undefined {
  return typeof command === 'string' ? parseCommand(command, 0) : undefined;
}
