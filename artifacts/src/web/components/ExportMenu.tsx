import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { useEffect, useState, type RefObject } from 'react';
import { Icon } from './Icon';
import { downloadHtml, snapshotHtml } from '../ui4a/export';

export function ExportMenu({ target, filename = 'macaron-card', disabled = false }: { target: RefObject<HTMLElement | null>; filename?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  useEffect(() => { if (!feedback || feedback.error) return; const timer = setTimeout(() => setFeedback(undefined), 2000); return () => clearTimeout(timer); }, [feedback]);
  const run = async (copy: boolean) => {
    setBusy(true); setFeedback(undefined);
    try {
      const surface = target.current?.querySelector<HTMLElement>('[data-ui4a-ready="true"]');
      if (!surface || disabled) throw new Error('预览尚未就绪，请稍后重试');
      const html = snapshotHtml(surface, filename);
      if (copy) { if (!navigator.clipboard) throw new Error('浏览器不支持复制，请下载 HTML'); await navigator.clipboard.writeText(html); }
      else downloadHtml(html, filename);
      setFeedback({ text: copy ? '已复制 HTML' : '已下载 HTML' });
    } catch (error) { setFeedback({ text: error instanceof Error ? error.message : '导出失败，请重试', error: true }); }
    finally { setBusy(false); }
  };
  return <div className="relative shrink-0">
    <Menu>
      <MenuButton type="button" title={disabled ? '预览完成后可导出' : '导出 HTML 快照'} aria-label="导出 HTML 快照" disabled={disabled || busy} onClick={() => setFeedback(undefined)} className="interactive grid size-9 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-hover-fg data-[open]:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"><Icon name={busy ? 'ellipsis' : 'arrowDown'} /></MenuButton>
      <MenuItems anchor={{ to: 'bottom end', gap: 6, padding: 8 }} className="theme-menu z-50 w-44 max-w-[calc(100vw-16px)] rounded-lg p-1 outline-none">
        <MenuItem><button type="button" onClick={() => void run(false)} className="interactive flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm data-[focus]:bg-surface-3 data-[focus]:text-hover-fg"><Icon name="arrowDown" />下载 HTML 快照</button></MenuItem>
        <MenuItem><button type="button" onClick={() => void run(true)} className="interactive block min-h-10 w-full rounded-md px-3 py-2 text-left text-sm data-[focus]:bg-surface-3 data-[focus]:text-hover-fg">复制 HTML 快照</button></MenuItem>
      </MenuItems>
    </Menu>
    {feedback ? <div role={feedback.error ? 'alert' : 'status'} className={`theme-widget absolute top-full right-0 z-20 mt-1 w-52 max-w-[calc(100vw-24px)] rounded-md p-2 text-xs break-words ${feedback.error ? 'text-danger' : 'text-fg'}`}><div className="flex items-start gap-1"><span className="min-w-0 flex-1">{feedback.text}</span><button type="button" onClick={() => setFeedback(undefined)} aria-label="关闭导出提示" className="grid size-6 shrink-0 place-items-center rounded hover:bg-surface-3"><Icon name="x" className="size-3" /></button></div></div> : null}
  </div>;
}
