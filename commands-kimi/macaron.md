---
description: Launch the Macaron WebUI (GenUI builder, model switcher, session manager)
---

This command is invoked as `/macaron:macaron`. It opens the v0 WebUI backed by Kimi Code sessions in `~/.kimi-code/sessions/`.

Resolve the plugin root by going two directories up from this command file. Read and follow `<plugin root>/skills/macaron-webui-kimi/SKILL.md` for launch, readiness, browser opening, and error handling.

Keep its `start.sh` launcher and `MACARON_ENGINE=kimi MACARON_FOREGROUND=1` settings. Use the port in `$ARGUMENTS` when supplied (substitute it in the launch command and browser URL); otherwise use `7980`.
