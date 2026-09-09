# Public releases

Use **Actions → Release to Public → Run workflow**, select `main`, and enter an existing source tag. Leave **dry_run** checked to build the filtered public tree, check bot identity and API-reported write permissions, and show the proposed diff. It writes no remote commits, tags, or mappings. No new source tag is created.

For a real release, fill in **summary** (under 72 characters) and **details** describing the public-facing changes, then uncheck **dry_run**. These become the public commit's subject and body; omit internal repository names, authors, and PR/issue references. No model generates or guesses release notes. The CLI likewise defaults to dry-run and requires `--publish` to write:

```sh
node .github/scripts/public-release.mjs --tag v1.2.3
node .github/scripts/public-release.mjs --tag v1.2.3 --publish --message-file public-notes.md
```

The workflow uses `ubuntu-latest`, Node.js, and Git. It does not require `pi`, a model key, `m sd`, or a self-hosted runner. The source repository's `GITHUB_TOKEN` reads its tag; the repository Actions secret **MINDLAB_BOT_GH_TOKEN** must belong to `mindlab-bot` and have Contents read/write access to both `MindLab-Research/macaron-artifacts` and `MindLab-Research/mindlab-bot`. This standalone script explicitly uses the bot token for both repositories, replacing the old template's separate runner login for mapping writes. A token stored only on an existing runner is not available to GitHub-hosted jobs.

The script implements the export and mapping rules from [mindlab-bot's release skill](https://github.com/MindLab-Research/mindlab-bot/blob/49bf494ea65da0eed857aeb055548889c3449d6e/.codex/skills/release/SKILL.md):

Release scripts and tests live under `.github/`, so the public snapshot automatically excludes them.

- Read the current `config/repositories.json` and `config/commits.json`; verify the source/public pair and the legacy source URL redirect.
- Construct a Git tree from the exact source tag, preserving tracked files, executable modes, and symlinks. Exclude `.github/` at every level and apply only the configured gitignore-style `public_exclude` rules. Source `.gitignore` and archive filters do not silently remove tracked files. Unexcluded submodules and empty exports fail explicitly.
- Create a snapshot commit as `mindlab-bot <contact@mindlab.ltd>` with only the existing public history as its parent. Source history never becomes public ancestry.
- Push public `main` and the tag atomically, rejecting any ref change since the initial read. Repeating an already-published tag is idempotent and never rewinds a newer public `main`.
- Write only this project's source/public hash mapping, retrying against the latest bot config when another project updates it concurrently. If mapping write fails after public publication, rerun the same release to repair it without another public commit.

**force** explicitly permits replacing a conflicting public tag and mapping using exact ref leases. It appends a corrective snapshot; it does not erase old public commits or anonymize previously published history. Dry-run remains read-only even with force selected.

A dry-run cannot prove branch rules will accept a later push. GitHub cannot transact across two repositories: public publication and mapping update are separate operations, and failures report which side completed. After publishing, verify the public `main/tag`, filtered files, bot authorship, and recorded mapping. Source CI should pass before choosing a release tag; the sync script does not execute or build code from that tag.
