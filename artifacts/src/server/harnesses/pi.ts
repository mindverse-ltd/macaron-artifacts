import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession, CreateAgentSessionOptions, FileEntry, SessionHeader, SessionManager } from '@earendil-works/pi-coding-agent';
import type { ChatChunk } from '../../shared/types.js';
import type { HarnessAdapter, HarnessTurn } from './types.js';
import { abortable, abortError, EventQueue, record, safeError } from './common.js';
import { PiEventMapper } from './pi-events.js';

type PiSdk = typeof import('@earendil-works/pi-coding-agent');
type RequestContext = Parameters<AgentSession['agent']['streamFunction']>[1];
type Bootstrap = { version: 1; instructions: string; systemPrompt: string; tools: NonNullable<RequestContext['tools']> };
const BOOTSTRAP = 'macaron-artifacts:pi-bootstrap';
const toolSchemas = (tools: RequestContext['tools']): NonNullable<RequestContext['tools']> => (tools ?? []).map(tool => ({ name: tool.name, description: tool.description, parameters: JSON.parse(JSON.stringify(tool.parameters)), ...(tool.constrainedSampling !== undefined ? { constrainedSampling: structuredClone(tool.constrainedSampling) } : {}) }));

/** A unique in-memory native identity prevents cleanup collisions; provider affinity still uses the parent's id. */
export function piMetadataEntries(entries: FileEntry[]): { entries: FileEntry[]; affinity: string } {
  const copy = structuredClone(entries), header = copy[0];
  if (header?.type !== 'session' || !header.id) throw new Error('Pi session has no valid header');
  if (!copy.some(entry => entry.type === 'message' && entry.message.role === 'assistant')) throw new Error('Metadata generation requires a completed native Pi response');
  const affinity = header.id;
  header.id = randomUUID();
  return { entries: copy, affinity };
}

/** Keep the native tool catalog unchanged; block execution before extension/tool callbacks on metadata turns. */
export function installPiApprovalGate(session: AgentSession, turn: HarnessTurn) {
  const previous = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    if (turn.enrichment) return { block: true, terminate: true, reason: 'Metadata generation cannot execute tools' };
    const activeSignal = signal ? AbortSignal.any([turn.signal, signal]) : turn.signal;
    if (activeSignal.aborted) return { block: true, terminate: true, reason: 'The turn was interrupted' };
    const result = await previous?.(context, activeSignal);
    if (result?.block) return result;
    const approved = await abortable(turn.approve({ id: context.toolCall.id, tool: context.toolCall.name, input: context.args }), activeSignal);
    return approved ? undefined : { block: true, reason: 'Denied by the user' };
  };
}

async function readNativeSession(sdk: PiSdk, filename: string): Promise<FileEntry[]> {
  // SessionManager.open repairs unterminated JSONL by writing a newline. Metadata must be strictly read-only on the parent.
  const entries = sdk.parseSessionEntries(await readFile(filename, 'utf8'));
  if (entries[0]?.type !== 'session' || !entries[0].id) throw new Error('Pi session has no valid header');
  return entries;
}

export async function createPiSession(turn: HarnessTurn, suppliedSdk?: PiSdk) {
  const sdk = suppliedSdk ?? await import('@earendil-works/pi-coding-agent');
  if (turn.signal.aborted) throw abortError();
  if (turn.enrichment && !turn.nativeId) throw new Error('Metadata generation requires a completed native Pi session');
  const agentDir = sdk.getAgentDir(), settingsManager = sdk.SettingsManager.create(turn.cwd, agentDir);
  const loader = new sdk.DefaultResourceLoader({ cwd: turn.cwd, agentDir, settingsManager, appendSystemPromptOverride: base => [...base, turn.instructions] });
  let manager: SessionManager | undefined, affinity: string | undefined, bootstrap: Bootstrap | undefined, session: AgentSession | undefined;
  if (turn.nativeId) {
    const entries = await readNativeSession(sdk, turn.nativeId), header = entries[0] as SessionHeader;
    if (path.resolve(header.cwd) !== path.resolve(turn.cwd)) throw new Error('Pi session belongs to a different working directory');
    if (turn.enrichment) {
      const fork = piMetadataEntries(entries); affinity = fork.affinity;
      manager = sdk.SessionManager.inMemory(turn.cwd, undefined, fork.entries);
      const saved = manager.getBranch().findLast(entry => entry.type === 'custom' && entry.customType === BOOTSTRAP);
      const value = saved?.type === 'custom' ? record(saved.data) : {};
      if (value.version !== 1 || value.instructions !== turn.instructions || typeof value.systemPrompt !== 'string' || !Array.isArray(value.tools)) throw new Error('Pi session is missing its matching UI4A bootstrap');
      bootstrap = value as Bootstrap;
    } else manager = sdk.SessionManager.open(turn.nativeId);
  }
  try {
    await loader.reload();
    if (turn.signal.aborted) throw abortError();
    const modelRuntime = await sdk.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json'), signal: turn.signal });
    const model = turn.model ? sdk.resolveCliModel({ cliModel: turn.model, modelRuntime }) : undefined;
    if (model?.error) throw new Error(model.error);
    const options: CreateAgentSessionOptions = { cwd: turn.cwd, agentDir, settingsManager, resourceLoader: loader, modelRuntime, sessionManager: manager, ...(model?.model ? { model: model.model, thinkingLevel: model.thinkingLevel } : {}) };
    const created = await sdk.createAgentSession(options);
    session = created.session;
    if (turn.enrichment && created.modelFallbackMessage) throw new Error(created.modelFallbackMessage);
    const current = session;
    installPiApprovalGate(current, turn);
    // Confirmation requests from native extensions can use the shared approval UI;
    // richer terminal dialogs keep the SDK's cancellation defaults.
    const ui = current.extensionRunner.getUIContext();
    await current.bindExtensions({ mode: 'print', uiContext: { ...ui, confirm: async (title, message, options) => turn.enrichment ? false : abortable(turn.approve({ id: randomUUID(), tool: title, input: { message } }), options?.signal ? AbortSignal.any([turn.signal, options.signal]) : turn.signal) }, abortHandler: () => { void current.abort(); } });
    if (turn.signal.aborted) throw abortError();
    if (affinity) current.agent.sessionId = affinity;
    const nativeStream = current.agent.streamFunction;
    let captured: Bootstrap | undefined;
    current.agent.streamFunction = (model, context, options) => {
      if (bootstrap) context = { ...context, systemPrompt: bootstrap.systemPrompt, tools: toolSchemas(bootstrap.tools) };
      else captured = { version: 1, instructions: turn.instructions, systemPrompt: context.systemPrompt ?? '', tools: toolSchemas(context.tools) };
      return nativeStream(model, context, options);
    };
    return {
      session: current,
      saveBootstrap() { if (!turn.enrichment && captured) current.sessionManager.appendCustomEntry(BOOTSTRAP, captured); },
      async dispose() {
        try { await current.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); }
        finally { current.dispose(); await settingsManager.flush(); }
      },
    };
  } catch (error) { session?.dispose(); await settingsManager.flush(); throw error; }
}

export async function* runPiSession(turn: HarnessTurn, create = createPiSession): AsyncIterable<ChatChunk> {
  const local = new AbortController(), signal = AbortSignal.any([turn.signal, local.signal]), activeTurn = { ...turn, signal };
  const runtime = await create(activeTurn), session = runtime.session, queue = new EventQueue<ChatChunk>(), mapper = new PiEventMapper();
  let task: Promise<void> | undefined, cancelling: Promise<void> | undefined;
  const cancel = () => { cancelling ??= session.abort(); void cancelling.catch(error => queue.fail(error)); };
  const unsubscribe = session.subscribe(event => { for (const chunk of mapper.map(event)) queue.push(chunk); });
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw abortError();
    if (!turn.enrichment) {
      if (!session.sessionFile) throw new Error('Pi did not create a durable session');
      turn.onNativeSession(session.sessionFile);
    }
    task = (async () => {
      try {
        await session.prompt(turn.prompt);
        await session.waitForIdle();
        if (signal.aborted) throw abortError();
        const assistant = session.messages.findLast(message => message.role === 'assistant');
        if (assistant?.role === 'assistant' && ['error', 'aborted'].includes(assistant.stopReason)) throw new Error(assistant.errorMessage || 'Pi ended without a completed response');
        runtime.saveBootstrap();
        for (const chunk of mapper.finish()) queue.push(chunk);
        queue.end();
      } catch (error) { queue.fail(error); }
    })();
    for await (const chunk of queue) yield chunk;
  } catch (error) { if (signal.aborted) throw abortError(); throw new Error(safeError(error)); }
  finally {
    local.abort();
    try { await task; await cancelling; }
    finally { signal.removeEventListener('abort', cancel); unsubscribe(); await runtime.dispose(); }
  }
}

export const piAdapter: HarnessAdapter = {
  id: 'pi',
  async info() {
    let version: string | undefined;
    try { version = (await import('@earendil-works/pi-coding-agent')).VERSION; } catch { /* Optional harness dependency may be unavailable. */ }
    return { id: 'pi', name: 'pi', available: Boolean(version), detail: version ? `pi SDK ${version}` : 'Install the Pi coding-agent SDK', capabilities: { textDeltas: true, reasoningDeltas: true, toolInputDeltas: true, commandOutputDeltas: true, approvals: true, fork: true } };
  },
  run: runPiSession,
};
