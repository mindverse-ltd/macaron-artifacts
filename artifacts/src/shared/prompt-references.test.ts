import { expect, test } from 'bun:test';
import { promptReferences, referenceQuery, removePromptReference } from './prompt-references';
test('parses unique file and Canvas references and removes only the selected token', () => { expect(promptReferences('check @src/theme.ts and @Canvas @src/theme.ts')).toEqual([{ path: 'src/theme.ts', label: 'src/theme.ts' }, { path: 'Canvas', label: 'Canvas' }]); expect(removePromptReference('check @src/theme.ts and @Canvas', 'src/theme.ts')).toBe('check and @Canvas'); expect(referenceQuery('check @src/')).toBe('src/'); });
