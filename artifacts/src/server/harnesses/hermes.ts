import type { ChatChunk } from '../../shared/types.js';
import type { HarnessAdapter, HarnessTurn, ResolvedProfile } from './types.js';
import type { ProfileOptions } from '../../shared/profiles.js';
import { abortError, executableVersion, record, safeError, string, EventQueue, abortable } from './common.js';
import { HermesRpc, rpcPayload } from './hermes-server.js';

type ModelSelection = { model: string; provider?: string };
type NativeRef = { sessionId: string; storedId?: string; profile?: string; selection?: ModelSelection };
const encode = (value: NativeRef) => `hermes:${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
const decode = (value: string): NativeRef => { if (!value.startsWith('hermes:')) return { sessionId: value }; try { return JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as NativeRef; } catch { return { sessionId: value }; } };
const gatewayUrl = (profile: HarnessTurn['profile']) => profile?.config.gatewayUrl || process.env.MACARON_HERMES_URL;
const profileName = (profile: HarnessTurn['profile']) => profile?.config.nativeProfile;
const connections = new Map<string, HermesRpc>();
const connectionKey = (turn: HarnessTurn) => `${turn.cwd}\0${gatewayUrl(turn.profile) || 'managed'}\0${profileName(turn.profile) || ''}`;
const connectionFor = (turn: Pick<HarnessTurn, 'cwd' | 'profile'>, token?: string) => {
  const key = connectionKey(turn as HarnessTurn), existing = connections.get(key);
  if (existing) return existing;
  const rpc = new HermesRpc({ cwd: turn.cwd, binary: process.env.MACARON_HERMES_PATH || 'hermes', profile: profileName(turn.profile), token, url: gatewayUrl(turn.profile), secrets: token ? [token] : [], onFailure: () => { if (connections.get(key) === rpc) connections.delete(key); } });
  connections.set(key, rpc); return rpc;
};
export async function closeHermesConnections() { const values = [...connections.values()]; connections.clear(); await Promise.allSettled(values.map(value => value.close())); }

function assertSupported(profile: HarnessTurn['profile']) {
  if (profile?.config.baseUrl || profile?.apiKey) throw new Error('Hermes uses its own profile/provider credentials; base URL and API-key overrides are not supported by the native gateway adapter');
}

function resolveModelSelection(model: string, payload: Record<string, unknown>): ModelSelection {
  const providers = (Array.isArray(payload.providers) ? payload.providers : []).map(record);
  const candidates = providers.flatMap(row => {
    const slug = string(row.slug), aliases = [slug, ...(Array.isArray(row.aliases) ? row.aliases.map(string) : [])].filter(Boolean);
    if (!slug) return [];
    const normalized = slug.toLowerCase().replaceAll(' ', '-'), canonical = normalized.startsWith('custom:') ? normalized : `custom:${normalized}`;
    const provider = row.is_user_defined ? canonical : slug;
    return [...new Set([provider, ...aliases])].map(alias => ({ prefix: `${alias}/`, provider, models: Array.isArray(row.models) ? row.models.map(string) : [] }));
  }).sort((a, b) => b.prefix.length - a.prefix.length);
  // Match picker IDs before interpreting a slash: vendor/model is also a valid native model ID.
  const exact = candidates.find(candidate => model.startsWith(candidate.prefix) && candidate.models.includes(model.slice(candidate.prefix.length)));
  if (exact) return { model: model.slice(exact.prefix.length), provider: exact.provider };
  if (providers.some(row => Array.isArray(row.models) && row.models.includes(model))) return { model };
  const prefixed = candidates.find(candidate => model.startsWith(candidate.prefix) && model.length > candidate.prefix.length);
  return prefixed ? { model: model.slice(prefixed.prefix.length), provider: prefixed.provider } : { model };
}

function modelSwitchCommand({ model, provider }: ModelSelection): string {
  // Hermes splits on whitespace, not with shlex. Reject inputs its flag/dash parsing would silently change.
  const command = `${model}${provider ? ` --provider ${provider}` : ''} --session`;
  const changesSpacing = model.trim().replace(/[\s\u0085\u001c-\u001f]+/g, ' ') !== model || /[\s\u0085\u001c-\u001f]/.test(provider || '');
  const changesFlags = /(?:^|\s)--(?:provider|global|session|refresh|once)(?=\s|$)/.test(model) || /[\u2012-\u2015](?:provider|global|session|refresh|once)/.test(command);
  if (changesSpacing || changesFlags) throw new Error('Hermes cannot safely switch to this model through its native command parser');
  return command;
}

export const hermesAdapter: HarnessAdapter = {
  id: 'hermes' as HarnessAdapter['id'],
  async info() { const version = await executableVersion(process.env.MACARON_HERMES_PATH || 'hermes'); return { id: 'hermes' as HarnessAdapter['id'], name: 'Hermes', available: Boolean(version), detail: version || 'Install Hermes Agent', capabilities: { textDeltas: true, reasoningDeltas: true, toolInputDeltas: false, commandOutputDeltas: false, approvals: true, fork: false } }; },
  async profileOptions(cwd: string, profile?: ResolvedProfile): Promise<ProfileOptions> {
    const rpc = connectionFor({ cwd, profile });
    const payload = rpcPayload(await rpc.request('model.options', { explicit_only: true }, AbortSignal.timeout(15_000)));
    const models = [] as ProfileOptions['models'];
    for (const row of Array.isArray(payload.providers) ? payload.providers : []) {
      const provider = record(row), slug = string(provider.slug), name = string(provider.name) || slug;
      for (const model of Array.isArray(provider.models) ? provider.models : []) { const id = string(model); if (id) models.push({ id: slug ? `${slug}/${id}` : id, name: `${name} · ${id}`, provider: slug }); }
    }
    return { models, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] };
  },
  async *run(turn: HarnessTurn): AsyncGenerator<ChatChunk> {
    if (turn.signal.aborted) throw abortError(); assertSupported(turn.profile);
    const ref = turn.nativeId ? decode(turn.nativeId) : undefined;
    if (ref?.profile && ref.profile !== profileName(turn.profile)) throw new Error('Hermes session belongs to a different native profile; start a new session before switching Hermes profiles');
    const token = turn.profile?.authToken;
    const rpc = connectionFor(turn, token);
    let nativeId = ref?.sessionId || '', storedId = ref?.storedId, activeTurn = false, done = false, textId = '', textSequence = 0, messageText = '', lastText = '', interimText = '', thoughtId = '', thoughtSequence = 0, metadataText = '', resolveDone!: () => void, rejectDone!: (error: Error) => void;
    const completed = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    void completed.catch(() => {});
    const queue = new EventQueue<ChatChunk>();
    const push = (items: ChatChunk[]) => { for (const item of items) queue.push(item); };
    // AI SDK appends a delta to its original part: seal segments before tools/reasoning to retain native chronology.
    const endText = () => { if (textId) { push([{ type: 'text-end', id: textId }]); textId = ''; } };
    const endThought = () => { if (thoughtId) { push([{ type: 'reasoning-end', id: thoughtId }]); thoughtId = ''; } };
    const appendText = (text: string) => { if (!text) return; endThought(); if (!textId) { textId = `hermes-message-${++textSequence}`; lastText = ''; push([{ type: 'text-start', id: textId }]); } interimText = ''; messageText += text; lastText += text; push([{ type: 'text-delta', id: textId, delta: text }]); };
    const appendSnapshot = (text: string) => {
      // Hermes adds one paragraph break to the first delta after tools; final_response omits that transport separator.
      // Compare snapshots against it without rewriting deltas or collapsing whitespace inside the model's Markdown.
      const streamed = messageText.startsWith('\n\n') && !text.startsWith(messageText) ? messageText.slice(2) : messageText;
      if (!text || text === streamed || text === lastText || `\n\n${text}` === lastText || !messageText && text === interimText) return;
      if (text.startsWith(streamed)) appendText(text.slice(streamed.length)); else { endText(); messageText = ''; appendText(text); }
    };
    const fail = (error: Error) => { queue.fail(error); rejectDone(error); };
    const unsub = rpc.onEvent(event => {
      const type = string(event.type), sid = string(event.session_id), payload = record(event.payload);
      if (nativeId && sid && sid !== nativeId) return;
      if (turn.enrichment && type === 'btw.complete') { metadataText += string(payload.text); if (metadataText) push([{ type: 'text-start', id: 'hermes-metadata' }, { type: 'text-delta', id: 'hermes-metadata', delta: metadataText }, { type: 'text-end', id: 'hermes-metadata' }]); done = true; queue.end(); resolveDone(); return; }
      if (turn.enrichment) return;
      if (!activeTurn) return;
      if (type === 'message.start') { push([]); return; }
      if (type === 'message.delta') appendText(string(payload.text));
      else if (type === 'message.interim') { if (!payload.already_streamed) appendSnapshot(string(payload.text)); endText(); endThought(); interimText = string(payload.text) || messageText; messageText = ''; lastText = ''; }
      // Hermes thinking.delta replaces/clears a CLI activity label, not model reasoning. The host owns its busy state.
      else if (type === 'thinking.delta') return;
      else if (type === 'reasoning.delta') { const text = string(payload.text); if (text) endText(); if (text && !thoughtId) { thoughtId = `hermes-reasoning-${++thoughtSequence}`; push([{ type: 'reasoning-start', id: thoughtId }]); } if (text) push([{ type: 'reasoning-delta', id: thoughtId, delta: text }]); }
      else if (type === 'tool.start') { endText(); endThought(); messageText = ''; lastText = ''; interimText = ''; push([{ type: 'tool-input-available', toolCallId: string(payload.tool_id), toolName: string(payload.name), input: payload.args ?? {}, dynamic: true, providerExecuted: true }]); }
      else if (type === 'tool.complete') { const id = string(payload.tool_id); push([{ type: 'tool-output-available', toolCallId: id, output: payload.result ?? payload.result_text ?? '', dynamic: true, providerExecuted: true }]); }
      // Complete carries result.final_response, not the turn's accumulated interim text. A sealed UI part may already contain it.
      else if (type === 'message.complete') {
        endThought();
        if (payload.status === 'error' || payload.status === 'interrupted') { endText(); fail(new Error(string(payload.error) || `Hermes turn ${payload.status}`)); return; }
        appendSnapshot(string(payload.text)); endText(); done = true; queue.end(); resolveDone();
      }
      else if (type === 'error' || type === 'connection.error') fail(new Error(string(payload.message) || 'Hermes turn failed'));
      else if (type === 'approval.request') {
        void abortable(turn.approve({ id: string(payload.request_id), tool: 'terminal', input: payload }), turn.signal)
          .then(approved => rpc.request('approval.respond', { session_id: nativeId, request_id: payload.request_id, choice: approved ? 'once' : 'deny' }))
          .catch(error => fail(error instanceof Error ? error : new Error(String(error))));
      }
    });
    const abort = () => { if (!turn.enrichment) void rpc.request('session.interrupt', { session_id: nativeId }).catch(() => {}); fail(abortError()); };
    turn.signal.addEventListener('abort', abort, { once: true });
    try {
      if (turn.enrichment) {
        if (!nativeId) throw new Error('Hermes metadata generation requires a completed native session');
        activeTurn = true;
        await rpc.request('prompt.btw', { session_id: nativeId, text: turn.prompt }, turn.signal);
      } else {
        const selection = turn.model ? resolveModelSelection(turn.model, turn.model.includes('/') ? rpcPayload(await rpc.request('model.options', { explicit_only: true }, turn.signal, 15_000)) : {}) : undefined;
        if (!nativeId) {
          const result = rpcPayload(await rpc.request('session.create', { cwd: turn.cwd, source: 'macaron-artifacts', ...selection, ...(turn.profile?.config.effort ? { reasoning_effort: turn.profile.config.effort } : {}) }, turn.signal));
          nativeId = string(result.session_id); storedId = string(result.stored_session_id) || nativeId; if (!nativeId) throw new Error('Hermes did not return a session id');
        } else {
          // cwd belongs to session.create; resume restores the session workspace and rejects extra parameters in current Hermes contracts.
          const resumed = rpcPayload(await rpc.request('session.resume', { session_id: storedId || nativeId, source: 'macaron-artifacts', omit_messages: true }, turn.signal)); nativeId = string(resumed.session_id) || nativeId; storedId = storedId || string(resumed.stored_session_id) || nativeId;
          // Creation already applies structured overrides. Resumed sessions need native session-only switches.
          if (selection && (selection.model !== ref?.selection?.model || selection.provider !== ref?.selection?.provider)) {
            const result = rpcPayload(await rpc.request('config.set', { session_id: nativeId, key: 'model', value: modelSwitchCommand(selection) }, turn.signal));
            if (result.confirm_required) throw new Error(string(result.confirm_message) || 'Hermes requires confirmation before switching models; confirm the selection in Hermes before retrying');
          }
          if (turn.profile?.config.effort) await rpc.request('config.set', { session_id: nativeId, key: 'reasoning', value: turn.profile.config.effort, scope: 'session' }, turn.signal);
        }
        // Hermes persists model overrides across cold resumes; keep the applied selection to avoid repeating confirmation-only switches.
        turn.onNativeSession(encode({ sessionId: nativeId, storedId, profile: profileName(turn.profile), selection: selection || ref?.selection }));
        // Repeat host context per native turn: extra system messages are transport-dependent, and non-branch seeds can vanish on cold resume.
        const prompt = turn.instructions ? `Host rendering context for this session:\n\n${turn.instructions}\n\nCurrent user request:\n\n${turn.prompt}` : turn.prompt;
        activeTurn = true; await rpc.request('prompt.submit', { session_id: nativeId, text: prompt }, turn.signal);
      }
      yield* queue;
      await completed;
    } catch (error) { if (turn.signal.aborted) throw abortError(); throw new Error(safeError(error)); }
    finally { turn.signal.removeEventListener('abort', abort); unsub(); }
  },
};

export { decode as decodeHermesNativeId, encode as encodeHermesNativeId };
