import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useState } from 'react';
import type { HarnessId, HarnessInfo } from '../../shared/types';
import { Button, Field } from './ui4a-ui';
import { Select } from './Select';

export function NewSessionDialog({ harnesses, initialHarness, initialCwd, onClose, onCreate }: { harnesses: HarnessInfo[]; initialHarness?: HarnessId; initialCwd: string; onClose: () => void; onCreate: (input: { harness: HarnessId; cwd: string; model?: string }) => Promise<void> }) {
  const [harness, setHarness] = useState<HarnessId>(initialHarness ?? harnesses.find(item => item.available)?.id ?? 'claude-code');
  const [cwd, setCwd] = useState(initialCwd);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const info = harnesses.find(item => item.id === harness);
  const submit = async () => { if (!cwd.trim() || !info?.available || busy) return; setBusy(true); setError(undefined); try { await onCreate({ harness, cwd: cwd.trim(), ...(model.trim() ? { model: model.trim() } : {}) }); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  return <Dialog open onClose={() => { if (!busy) onClose(); }} className="relative z-50"><div className="fixed inset-0 bg-black/40" /><div className="fixed inset-0 flex items-center justify-center p-4"><DialogPanel className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-2xl"><DialogTitle className="mb-4 text-base font-medium">新会话</DialogTitle><form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4"><div className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted">Harness</span><Select label="Harness" value={harness} onChange={setHarness} options={harnesses.map(item => ({ value: item.id, label: `${item.name}${item.available ? '' : ' · 未安装'}`, disabled: !item.available }))} />{info?.detail ? <p className="text-xs leading-relaxed text-muted">{info.detail}</p> : null}</div><Field autoFocus label="工作区" value={cwd} onChange={event => setCwd(event.target.value)} placeholder="/path/to/project" required /><Field label="模型" value={model} onChange={event => setModel(event.target.value)} placeholder="使用 harness 默认模型" hint="留空时继承这个 harness 的配置。" />{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}<div className="mt-1 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !cwd.trim() || !info?.available}>{busy ? '正在创建…' : '创建会话'}</Button></div></form></DialogPanel></div></Dialog>;
}
