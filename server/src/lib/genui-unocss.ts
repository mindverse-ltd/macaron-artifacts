import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { UnocssLintToolkit } from '@genui/diagnostics/lint';
import type { UserConfig } from '@unocss/core';
import { WEB_ROOT } from '../config.js';

let toolkitPromise: Promise<UnocssLintToolkit> | undefined;

export const loadGenUIUnocssToolkit = (): Promise<UnocssLintToolkit> =>
  (toolkitPromise ??= Promise.all([
    import('@unocss/core'),
    import('@unocss/autocomplete'),
    // This source-only legacy server shares the browser config without adding
    // browser files to its separate TS compilation root.
    import(pathToFileURL(path.resolve(WEB_ROOT, '../artifacts/src/web/theme/uno.js')).href) as Promise<{ unoConfig: (scope?: string) => UserConfig }>,
  ]).then(async ([core, autocomplete, { unoConfig }]) => {
    const generator = await core.createGenerator(unoConfig('.ui4a-surface'), { separators: [] });
    return { generator, autocomplete: autocomplete.createAutocomplete(generator) };
  }));
