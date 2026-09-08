"""Replay real Claude Code sessions at the moment they asked "should I commit?".

Mines ~/.claude/projects for sessions where an assistant turn ENDED by handing a
commit decision back to the user in prose, then re-samples that exact turn with
our render_ui surfaces installed, asking: would the model render a widget instead?

The context is the session's own user/assistant/tool_result stream, verbatim and
in file order. Nothing is executed — the replay stops at the first tool call the
transcript has no recorded output for, rather than inventing one.

Env: ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL (no secrets here).
Usage: python scripts/smoke/replay_ask_moments.py [--limit N] [--out DIR]
"""

import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path.home() / '.claude/projects'
REPO = Path(__file__).resolve().parents[2]
BASE = os.environ.get('ANTHROPIC_BASE_URL', 'http://localhost:4000')
TOKEN = os.environ.get('ANTHROPIC_AUTH_TOKEN') or sys.exit('set ANTHROPIC_AUTH_TOKEN')
MODEL = os.environ.get('ANTHROPIC_MODEL', 'claude-opus-5')

COMMITWORD = re.compile(r'(commit|push|提交|开\s*PR|open a pr|pull request)', re.I)
ASKDECIDE = re.compile(r"(告诉我|你(要|想)(不要|怎么)|要不要|需要我|是否(要|需要)|怎么处理|你决定"
                       r"|say the word|let me know|tell me|want me to|should i|shall i"
                       r"|if you(\'d| would) (like|prefer|rather))", re.I)
GENERIC = {'type': 'object', 'properties': {}, 'additionalProperties': True}
RENDER = 'mcp__macaron__render_ui'


def surfaces():
    """The REAL shipped instructions + tool description, read from the built server."""
    js = REPO / 'server/dist/lib/macaron-render-tool.js'
    out = subprocess.run(['node', '-e', f'const m=require({str(js)!r});'
                          'console.log(JSON.stringify({i:m.RENDER_UI_INSTRUCTIONS,d:m.RENDER_UI_TOOL_DESCRIPTION}))'],
                         capture_output=True, text=True, check=True)
    s = json.loads(out.stdout)
    return s['i'], s['d']


INSTR, DESC = surfaces()
SYSTEM = ("You are Claude Code, Anthropic's official CLI for coding.\n\n" + INSTR +
          f"\n\nThe `{RENDER}` tool is available. Other tools' schemas are elided for this replay.")


def load(path):
    recs = []
    for line in path.read_text(errors='replace').splitlines():
        try:
            recs.append(json.loads(line))
        except ValueError:
            pass
    return recs


def text_of(msg):
    c = msg.get('content')
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return '\n'.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
    return ''


def is_human(rec):
    """A real human prompt — not a tool_result, hook injection, or meta record."""
    if rec.get('type') != 'user' or rec.get('isMeta') or rec.get('toolUseResult') is not None:
        return False
    c = (rec.get('message') or {}).get('content')
    return not (isinstance(c, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c))


def ask_moments(recs):
    """Assistant text records that END the turn (next message is a human prompt) by
    handing a commit decision back. That is the moment render_ui should have fired."""
    out = []
    idxs = [i for i, r in enumerate(recs) if r.get('type') in ('user', 'assistant')]
    for pos, i in enumerate(idxs):
        r = recs[i]
        if r.get('type') != 'assistant':
            continue
        blocks = (r.get('message') or {}).get('content') or []
        if isinstance(blocks, list) and any(isinstance(b, dict) and b.get('type') == 'tool_use' for b in blocks):
            continue  # mid-turn narration, not the turn's end
        t = text_of(r.get('message') or {}).strip()
        if not t:
            continue
        nxt = recs[idxs[pos + 1]] if pos + 1 < len(idxs) else None
        if nxt is not None and not is_human(nxt):
            continue
        tail = t[-500:]
        if COMMITWORD.search(tail) and ASKDECIDE.search(tail):
            out.append((i, t))
    return out


def rebuild(recs, upto):
    """The API-shaped message list up to `upto`, verbatim and in file order."""
    msgs = []
    for r in recs[:upto]:
        if r.get('type') not in ('user', 'assistant'):
            continue
        m = r.get('message') or {}
        c = m.get('content')
        if c is None:
            continue
        if isinstance(c, list):
            c = [b for b in c if isinstance(b, dict) and
                 b.get('type') in ('text', 'tool_use', 'tool_result', 'image', 'thinking', 'redacted_thinking')]
            if not c:
                continue
        msgs.append({'role': m.get('role') or r['type'], 'content': c})
    merged = []
    for m in msgs:  # the API requires strict role alternation
        if merged and merged[-1]['role'] == m['role']:
            for k in ('content',):
                a, b = merged[-1][k], m[k]
                a = a if isinstance(a, list) else [{'type': 'text', 'text': a}]
                b = b if isinstance(b, list) else [{'type': 'text', 'text': b}]
                merged[-1][k] = a + b
        else:
            merged.append(dict(m))
    while merged and merged[-1]['role'] != 'user':
        merged.pop()
    return merged


def tools_used(recs, upto):
    names = set()
    for r in recs[:upto]:
        if r.get('type') != 'assistant':
            continue
        for b in (r.get('message') or {}).get('content') or []:
            if isinstance(b, dict) and b.get('type') == 'tool_use':
                names.add(b['name'])
    return names


def build_tools(names):
    # Offer the same tool surface the session had, so replayed tool_use blocks resolve.
    # render_ui is appended once — a session that already used it would otherwise
    # produce a duplicate tool name, which the API rejects with a 400.
    ts = [{'name': n, 'description': f'{n} tool (schema elided for replay; not executed).',
           'input_schema': GENERIC} for n in sorted(names - {RENDER})]
    ts.append({'name': RENDER, 'description': DESC,
               'input_schema': {'type': 'object', 'properties': {'code': {'type': 'string'}}, 'required': ['code']}})
    return ts


def sample(messages, tools, max_tokens=8000):
    body = {'model': MODEL, 'max_tokens': max_tokens, 'system': SYSTEM, 'tools': tools, 'messages': messages}
    req = urllib.request.Request(f'{BASE}/v1/messages', data=json.dumps(body).encode(),
                                headers={'Content-Type': 'application/json',
                                         'Authorization': f'Bearer {TOKEN}',
                                         'anthropic-version': '2023-06-01'})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


def main():
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0
    outdir = Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else Path('/tmp/mac-replay')
    outdir.mkdir(parents=True, exist_ok=True)

    sessions = [f for f in ROOT.rglob('*.jsonl') if len(f.relative_to(ROOT).parts) == 2]
    found = []
    for f in sessions:
        try:
            raw = f.read_text(errors='replace')
        except OSError:
            continue
        if not COMMITWORD.search(raw):
            continue
        recs = load(f)
        for i, _text in ask_moments(recs):
            found.append((f, i, recs))
    print(f'{len(sessions)} sessions scanned → {len(found)} prose ask-to-commit turn endings')
    if limit:
        found = found[:limit]

    rendered = 0
    for n, (f, i, recs) in enumerate(found):
        ctx = rebuild(recs, i)
        if not ctx:
            print(f'{n:3d} SKIP (no user turn) {f.parent.name[:40]}')
            continue
        try:
            r = sample(ctx, build_tools(tools_used(recs, i)))
        except Exception as e:  # noqa: BLE001 — one bad session shouldn't kill the sweep
            print(f'{n:3d} ERR  {type(e).__name__}: {str(e)[:120]}')
            continue
        code = next((b['input'].get('code', '') for b in r.get('content', [])
                     if b.get('type') == 'tool_use' and b['name'] == RENDER), None)
        if code:
            rendered += 1
            (outdir / f'replay_{n:02d}.tsx').write_text(code)
        calls = [b['name'] for b in r.get('content', []) if b.get('type') == 'tool_use']
        print(f'{n:3d} {f.parent.name[:38]:38s} {len(ctx):4d} msgs  rendered={bool(code)}  {calls}')
    print(f'\n{rendered}/{len(found)} re-sampled turns rendered a widget; TSX in {outdir}')
    print(f'next: node scripts/smoke/clickable.mjs {outdir}/*.tsx')


if __name__ == '__main__':
    main()
