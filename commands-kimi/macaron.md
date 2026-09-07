---
description: Launch the Macaron WebUI (GenUI builder, model switcher, session manager)
---

This command is invoked as `/macaron:macaron`. It opens the WebUI backed by Kimi Code sessions in `~/.kimi-code/sessions/`.

Resolve the plugin root by going two directories up from this command file, then follow `<plugin root>/skills/macaron-webui-kimi/SKILL.md` to install, build, and start the Kimi WebUI.

Use the port in `$ARGUMENTS` when supplied; otherwise use `7980`. Keep `MACARON_ENGINE=kimi` explicit and run the server in a persistent shell session. Check `/api/health` before opening the browser and returning the URL.
