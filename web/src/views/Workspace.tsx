import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, basename, fmtAgo, type SessionListItem, type Workspace as Wk } from '../lib/api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

export function Workspace() {
  const { project = '' } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Wk | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    setWorkspace(null);
    setSessions(null);
    api
      .workspace(project)
      .then((d) => {
        setWorkspace(d.workspace);
        setSessions(d.sessions);
      })
      .catch((e) => setError((e as Error).message));
  }, [project]);

  const name = workspace?.name || basename(workspace?.cwd || '') || project;
  const cwd = workspace?.cwd || '';

  return (
    <section className="view">
      <div className="crumbs">
        <Link to="/">Workspaces</Link>
        <span className="sep">›</span>
        <span>{name}</span>
      </div>
      <header>
        <h1>{name}</h1>
        <p className="muted-path">{cwd || '—'}</p>
      </header>
      <div className="wk-actions">
        <button
          className="primary small"
          onClick={() => navigate(`/w/${encodeURIComponent(project)}/new`)}
        >
          + New session
        </button>
        <button
          className="ghost small"
          onClick={() => {
            const cmd = `cd "${cwd}" && claude`;
            navigator.clipboard.writeText(cmd).then(() => toast('terminal command copied'));
          }}
        >
          Copy `cd &amp;&amp; claude`
        </button>
        <span className="meta">Starts a fresh session in this workspace (runs <code>claude -p</code> in <code>{cwd || '—'}</code>).</span>
      </div>

      <h2 className="sec-title">Sessions</h2>
      {error && <div className="placeholder">Error: {error}</div>}
      {!sessions && !error && <ul className="sess-list"><li className="muted">Loading…</li></ul>}
      {sessions && sessions.length === 0 && <ul className="sess-list"><li className="muted">No sessions yet.</li></ul>}
      {sessions && sessions.length > 0 && (
        <ul className="sess-list">
          {sessions.map((s) => (
            <li key={s.sessionId} className="sess-li">
              <Link className="sess-row" to={`/w/${encodeURIComponent(project)}/s/${encodeURIComponent(s.sessionId)}`}>
                <div className="sess-row-main">
                  <div className="sess-preview">{s.preview || '(no user prompt)'}</div>
                  <div className="sess-row-meta">
                    <span className="sess-id">{s.sessionId.slice(0, 8)}</span>
                    {s.gitBranch && <span className="sess-branch">{s.gitBranch}</span>}
                    <span>{s.messageCount}{s.messageCountSuffix || ''} msgs</span>
                    <span>{fmtAgo(s.mtime)}</span>
                  </div>
                </div>
                <div className="sess-chev">›</div>
              </Link>
              <button
                className="sess-del"
                title="Delete session"
                onClick={async (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  const ok = await confirm({
                    title: 'Delete session?',
                    body: (
                      <>
                        <code>{s.sessionId.slice(0, 8)}</code>
                        {s.preview && <> · "{s.preview.slice(0, 80)}{s.preview.length > 80 ? '…' : ''}"</>}
                        <div className="confirm-sub">Removes the jsonl from <code>~/.claude/projects/</code>. Cannot be undone.</div>
                      </>
                    ),
                    confirmLabel: 'Delete',
                    destructive: true,
                  });
                  if (!ok) return;
                  // Optimistic remove
                  setSessions((cur) => cur?.filter((x) => x.sessionId !== s.sessionId) ?? null);
                  try {
                    await api.deleteSession(project, s.sessionId);
                    toast(`deleted ${s.sessionId.slice(0, 8)}`);
                  } catch (e) {
                    toast(`delete failed: ${(e as Error).message}`);
                    api.workspace(project).then((d) => setSessions(d.sessions)).catch(() => {});
                  }
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
