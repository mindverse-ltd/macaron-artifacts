---
description: Launch the Macaron WebUI (GenUI builder, model switcher, session manager)
allowed-tools: Bash(bash:*), Bash(open:*), Bash(node:*), Bash(lsof:*), Bash(kill:*), Bash(echo:*)
argument-hint: "[port]"
---

Start the Macaron WebUI server. The port defaults to 7878; the user may pass an alternate port as `$1`.

Run exactly this command and report the printed URL to the user:

```bash
MACARON_PORT="${1:-7878}" bash "${CLAUDE_PLUGIN_ROOT}/start.sh"
```

If `$1` is empty, just run `bash "${CLAUDE_PLUGIN_ROOT}/start.sh"`.

Do not paraphrase the URL. After the server prints `Macaron WebUI: http://localhost:<port>`, also run `open "http://localhost:<port>"` to launch the browser. Then briefly tell the user what the three tabs do:

- **GenUI** — stream Macaron-generated TSX with live preview
- **Chat** — same prompt against Claude / Codex / Macaron-0.6, side-by-side
- **Sessions** — browse Claude & Codex history, copy a `--resume` command

If `lsof` reports the port is busy, the script kills the existing process first; this is expected.
