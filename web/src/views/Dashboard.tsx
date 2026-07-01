import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, basename, fmtAgo, type Workspace } from '../lib/api';

export function Dashboard() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    api
      .workspaces()
      .then((d) => setWorkspaces(d.workspaces))
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <section className="view">
      <header>
        <h1>Workspaces</h1>
        <p>
          Pick up where you left off. Each card is a directory where you've run Claude Code. Sessions sync with your
          local CLI in real time.
        </p>
      </header>
      {error && <div className="placeholder">Error: {error}</div>}
      {!workspaces && !error && <div className="muted">Loading…</div>}
      {workspaces && workspaces.length === 0 && (
        <div className="placeholder">No workspaces yet. Run <code>claude</code> in any project to create one.</div>
      )}
      {workspaces && workspaces.length > 0 && (
        <div className="wk-grid">
          {workspaces.map((w) => (
            <Link key={w.project} className="wk-card" to={`/w/${encodeURIComponent(w.project)}`}>
              <div className="wk-head">
                <div className="wk-name">{w.name || basename(w.cwd) || w.project}</div>
                <div className="wk-count">
                  {w.sessionCount} session{w.sessionCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="wk-path">{w.cwd || '—'}</div>
              <div className="wk-last">
                <div className="wk-preview">{w.lastPreview || '(no recent prompt)'}</div>
                <div className="wk-time">{fmtAgo(w.lastActivity)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
