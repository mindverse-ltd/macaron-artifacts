import { describe, expect, test } from 'bun:test';
import { quote } from 'shell-quote';
import { parseCommandActivities } from './command-activity';

describe('command activity display fallback', () => {
  test('reads quoted paths and preserves both files', () => {
    expect(parseCommandActivities('cat "docs/first file.md" \'second file.md\'')).toEqual([{ kind: 'read', target: 'docs/first file.md' }, { kind: 'read', target: 'second file.md' }]);
    expect(parseCommandActivities('head -n 20 src/main.ts')).toEqual([{ kind: 'read', target: 'src/main.ts' }]);
    expect(parseCommandActivities('tail -c100 -- "-file"')).toEqual([{ kind: 'read', target: '-file' }]);
    expect(parseCommandActivities('sed -n \'20,80p\' src/main.ts')).toEqual([{ kind: 'read', target: 'src/main.ts' }]);
  });

  test('distinguishes query from glob, context, and type options', () => {
    expect(parseCommandActivities('rg --heading -n --glob "*.tsx" -C 3 -t ts "useState hook" src tests')).toEqual([{ kind: 'search', target: 'useState hook', path: 'src' }, { kind: 'search', target: 'useState hook', path: 'tests' }]);
    expect(parseCommandActivities('rg --glob="*.ts" -- -pattern src')).toEqual([{ kind: 'search', target: '-pattern', path: 'src' }]);
    expect(parseCommandActivities('grep -rin --include="*.ts" -e needle src')).toEqual([{ kind: 'search', target: 'needle', path: 'src' }]);
    expect(parseCommandActivities('rg -e first -e second src')).toEqual([{ kind: 'search', target: 'first', path: 'src' }, { kind: 'search', target: 'second', path: 'src' }]);
  });

  test('recognizes directory listings and filename searches', () => {
    expect(parseCommandActivities('rg --files -g "*.ts" src')).toEqual([{ kind: 'list', target: 'src' }]);
    expect(parseCommandActivities('ls -lah src docs')).toEqual([{ kind: 'list', target: 'src' }, { kind: 'list', target: 'docs' }]);
    expect(parseCommandActivities('fd --max-depth 3 -t f "package.json" src')).toEqual([{ kind: 'search', target: 'package.json', path: 'src' }]);
    expect(parseCommandActivities('fd --hidden')).toEqual([{ kind: 'list', target: '.' }]);
  });

  test('accepts only fully recognized command sequences and bounded shell wrappers', () => {
    expect(parseCommandActivities('/bin/zsh -lc \'cat README.md && rg needle src; ls docs\'')).toEqual([{ kind: 'read', target: 'README.md' }, { kind: 'search', target: 'needle', path: 'src' }, { kind: 'list', target: 'docs' }]);
    expect(parseCommandActivities('sh -c "bash -c \'cat README.md\'"')).toEqual([{ kind: 'read', target: 'README.md' }]);
    expect(parseCommandActivities('cat README.md && rm secret')).toBeUndefined();
    expect(parseCommandActivities('sh -c \'cat README.md\' extra')).toBeUndefined();
    expect(parseCommandActivities(['sh', 'bash', 'zsh'].reduce((command, shell) => `${shell} -c ${quote([command])}`, 'cat README.md'))).toBeUndefined();
  });

  test('does not evaluate environment or executable shell syntax', () => {
    for (const command of ['cat $HOME/file', 'cat "${HOME}/file"', 'cat $(touch marker)', 'cat `touch marker`', 'cat README.md > output', 'cat README.md | tee output', 'fd pattern --exec rm {}', 'find . -exec cat {} \\;', 'cat *.md', 'for f in a; do cat "$f"; done']) expect(parseCommandActivities(command)).toBeUndefined();
    expect(parseCommandActivities("cat '$HOME/file'")).toEqual([{ kind: 'read', target: '$HOME/file' }]);
  });

  test('falls back on unknown flags, mutations, and incomplete input', () => {
    for (const command of ['sed -i \'1,2p\' file', 'rg --pre helper query src', 'rg --not-an-option query', 'head -n', 'head -n --unknown file', 'cat --quiet file', 'grep --glob "*.ts" query', 'ls --hidden', 'cat "unfinished', "cat 'unfinished", 'cat file\\', 'cat file &&', '; cat file', 'cat', '', 'rg', 'ls # comment']) expect(parseCommandActivities(command)).toBeUndefined();
    for (const command of [undefined, null, 1, { command: 'cat file' }]) expect(parseCommandActivities(command)).toBeUndefined();
  });
});
