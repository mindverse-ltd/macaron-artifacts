// Persistent Codex-runner config, held in ~/.claude/macaron-codex-config.json.
//
// The Codex CLI reads its provider/model/reasoning knobs from ~/.codex/config.toml,
// but our plugin needs the same knobs in a form we can pass via CodexOptions +
// ThreadOptions when spawning threads programmatically. This module gives us
// that: one JSON file the WebUI can edit, one loader the runner consumes.
//
// The apiKey lives in this file (not in git). Users paste it once via Settings.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HOME } from '../config.js';
const CONFIG_PATH = path.join(HOME, '.claude', 'macaron-codex-config.json');
function defaults() {
    return {
        provider: {
            name: 'Macaron GLM',
            baseUrl: 'https://pi-api-cn.macaron.xin',
            apiKey: process.env.MACARON_CODEX_API_KEY || '',
            model: 'gpt-5.5',
            wireApi: 'responses',
            modelProvider: 'OpenAI',
            reasoningEffort: 'high',
            sandboxMode: 'workspace-write',
            approvalPolicy: 'never',
            webSearchEnabled: false,
            contextWindow: 200_000,
            autoCompactTokenLimit: 180_000,
            disableResponseStorage: true,
        },
    };
}
let cache = null;
async function loadFromDisk() {
    try {
        const raw = await fs.readFile(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const d = defaults();
        return {
            provider: { ...d.provider, ...(parsed.provider || {}) },
        };
    }
    catch {
        return defaults();
    }
}
async function persist() {
    if (!cache)
        return;
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(cache, null, 2), 'utf8');
}
export async function warmCodexConfigCache() {
    cache = await loadFromDisk();
    await persist();
}
export function getCodexConfig() {
    return cache ?? defaults();
}
export async function updateCodexProvider(patch) {
    if (!cache)
        cache = await loadFromDisk();
    cache.provider = { ...cache.provider, ...patch };
    await persist();
    return cache;
}
export function readPublicCodexSettings() {
    const p = (cache ?? defaults()).provider;
    const { apiKey, ...rest } = p;
    return { provider: { ...rest, configured: Boolean(apiKey) } };
}
//# sourceMappingURL=codex-config.js.map