import type { HarnessId } from '../../shared/types.js';
import type { HarnessAdapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';

export const adapters: Record<HarnessId, HarnessAdapter> = { 'claude-code': claudeAdapter, codex: codexAdapter };
export const getHarness = (id: HarnessId): HarnessAdapter => adapters[id];
export const listHarnesses = () => Promise.all(Object.values(adapters).map((adapter) => adapter.info()));
