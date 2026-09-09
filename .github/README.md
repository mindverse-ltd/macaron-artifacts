# Public releases

Use **Actions → Release to Public → Run workflow**, select `main`, and enter an existing source version tag, such as `v1.0.0`. Leave **dry_run** checked to verify the runner tools, source tag, repository mapping, bot identity, and API-reported write permissions without invoking the release agent. This checks GitHub access; it does not test model-provider authentication or actual push acceptance under branch rules.

Uncheck **dry_run** only when ready to publish that tag from `mindverse-ltd/macaron-artifacts` to `MindLab-Research/macaron-artifacts` through the existing `mindlab-bot` release skill. It runs only when dispatched and does not force-push existing releases.

The release skill exports a snapshot without `.github/`, commits as `mindlab-bot <contact@mindlab.ltd>`, pushes public `main` and the tag, and records the source/public commit mapping in `MindLab-Research/mindlab-bot`.

Before the first run, a maintainer must provide a self-hosted runner available to this source repository with `bash`, `git`, `gh`, `jq`, `rsync`, and authenticated `pi` installed. A runner registered only to the `MindLab-Research` organization is not available to this `mindverse-ltd` repository.

The runner's normal `gh` credentials need source read access and `mindlab-bot` write access for the mapping. Public clone/push uses a separate bot token, supplied as the repository secret `MINDLAB_BOT_GH_TOKEN` or the runner's private `$HOME/.config/mindlab-bot/github-token` file. Do not use the source repository's `GITHUB_TOKEN` as the cross-repository credential.

The existing bot configuration selects `public_token_env: MINDLAB_BOT_GH_TOKEN` for Macaron Artifacts. An SSH key alone does not satisfy this configuration; switching to SSH also requires updating the bot's credential policy and this workflow. The old source name in its mapping, `mindverse-ltd/macaron-claude-code`, currently redirects to this repository and is checked through the GitHub API before publishing.

The dispatch button appears after this workflow is on the default branch. Validate the first real release by checking the public tag and `main`, bot commit identity, exported files, and the recorded commit mapping.
