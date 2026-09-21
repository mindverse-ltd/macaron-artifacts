# Public releases

Use **Actions → Release to Public → Run workflow**, select `main`, and enter an existing source tag (for example, `v1.0.0`). Leave **dry_run** checked to preview the public snapshot and diff without writing remote refs. No source tag is created.

For a real release, fill in **summary** (under 72 characters) and **details** describing the public-facing changes, then uncheck **dry_run**. These become the public commit's subject and body; omit internal repository names, authors, and PR/issue references. The CLI also defaults to dry-run:

```sh
node .github/scripts/public-release.mjs --tag v1.0.0
node .github/scripts/public-release.mjs --tag v1.0.0 --publish --message-file public-notes.md
```

The workflow needs only the source repository and the public target:

- `GITHUB_TOKEN` reads the selected tag from `mindverse-ltd/macaron-artifacts`.
- The Actions secret **MINDLAB_BOT_GH_TOKEN** must belong to `mindlab-bot` and have Contents read/write access to **MindLab-Research/macaron-artifacts** only.

## Automatic main synchronization

Every push to source `main` runs the same workflow in `--sync-main --publish` mode, publishing the filtered `main` snapshot to public `main`:

```sh
node .github/scripts/public-release.mjs --sync-main            # dry-run preview
node .github/scripts/public-release.mjs --sync-main --publish
```

Sync mode reads source `main` at run time into a non-checked-out tracking ref, so a queued burst converges on the latest snapshot instead of replaying an older event SHA. It **never creates or moves any version tag**, uses a generic public summary and body, and requires no notes input. `--sync-main` cannot be combined with `--tag` or `--force`; manual tag releases keep their own force path. When the filtered tree already matches a bot-authored public tip (for example, a `.github/`-only internal change), nothing is committed or pushed. Manual tag releases stay on `workflow_dispatch` and remain unchanged; both share one serialized concurrency group with up to 100 pending runs and no in-progress cancellation.

There is no private configuration repository, commit-mapping file, mapping credential, model, or self-hosted runner dependency. The source and target are fixed in the script.

The script exports the selected tag or current main tree, excluding `.github/` and `.git/` path components at every level. All other tracked files, executable modes, and symlinks are preserved; source `.gitignore` and archive filters do not silently drop tracked files. Submodules outside excluded paths and empty snapshots are rejected. Release scripts and tests live under `.github/` and are therefore excluded.

A snapshot commit is authored by `mindlab-bot <contact@mindlab.ltd>` with only the existing public history as its parent. Internal commit history and source tag annotations are not published. **One atomic push** updates public `main` and the public tag. An unchanged, already-published tag is a no-op; retrying an older published tag never rewinds newer public `main`. No mapping write follows the push.

**force** permits replacing a conflicting public tag using an exact ref lease; it appends a corrective snapshot rather than erasing public history. Dry-run stays read-only with force selected. Concurrent ref changes reject the atomic push rather than partially publishing.

API-reported permissions and dry-run do not prove branch-rule acceptance. After publishing, verify the public `main/tag`, filtered files, and bot authorship. Source CI should pass before choosing a release tag; the release script never executes or builds code from that tag.
