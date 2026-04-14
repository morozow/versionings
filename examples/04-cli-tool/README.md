# 04-cli-tool — CLI Tool

A CLI tool built with **yargs** featuring `greet` and `count` subcommands.
Demonstrates the **release-branch** strategy, **draft PR** mode, and
**PR templates** via versionings.

## Stack

- **Runtime:** Node.js ≥ 18
- **CLI framework:** yargs 17
- **Versioning:** versionings CLI

## CLI Tool and Subcommands

The `mytool` utility exposes two subcommands:

### greet

Greet a user in a selected language.

```bash
mytool greet --name Alice --lang en
# Hello, Alice!

mytool greet --name John
# Hello, John!

mytool greet --name Hans --lang de
# Hallo, Hans!
```

| Option | Type | Required | Default | Description |
|--------|------|:--------:|:-------:|-------------|
| `--name`, `-n` | string | yes | — | Name to greet |
| `--lang`, `-l` | en / ru / de | no | en | Greeting language |

### count

Count words, lines, and characters in a file.

```bash
mytool count README.md
# All metrics: lines, words, chars

mytool count README.md --words
# Word count only

mytool count README.md --lines --chars
# Lines and characters
```

| Option | Type | Description |
|--------|------|-------------|
| `<file>` | positional | Path to the file |
| `--words`, `-w` | boolean | Count words |
| `--lines`, `-l` | boolean | Count lines |
| `--chars`, `-c` | boolean | Count characters |

When no flags are provided, all three metrics are printed.

## Branching Strategy: release-branch

| Parameter | Value |
|-----------|-------|
| SCM platform | GitHub |
| Branching strategy | `release-branch` |
| Config format | `version.json` |

The **release-branch** strategy creates a dedicated `release/{version}` branch for
each release. Its key feature is **patch reuse**: if a branch `release/1.1.x` already
exists, subsequent patch releases (1.1.1, 1.1.2, …) reuse it instead of creating a
new one. This is well-suited for CLI tools where minor releases add subcommands and
patch releases fix bugs within the same release branch.

### How release-branch Works

1. `--semver=minor` creates branch `release/1.1.x`
2. Version is bumped to `1.1.0`; tag `1.1.0` is created
3. Next `--semver=patch` reuses branch `release/1.1.x`
4. Version is bumped to `1.1.1`; tag `1.1.1` is created
5. A new `--semver=minor` creates `release/1.2.x`

## SCM Platform: GitHub

GitHub is the hosting platform for this example. When `--push` is specified,
versionings automatically creates a Pull Request via the GitHub API. In this
example the PR is created in **draft** mode using a PR template.

## Draft PR Mode and PR Templates

The `version.json` configuration includes two PR-related settings:

```json
{
  "git": {
    "pr": {
      "target": "main",
      "draft": true,
      "template": ".github/PULL_REQUEST_TEMPLATE.md"
    }
  }
}
```

| Parameter | Value | Description |
|-----------|-------|-------------|
| `target` | `main` | Target branch for the PR |
| `draft` | `true` | PR is created as a draft |
| `template` | `.github/PULL_REQUEST_TEMPLATE.md` | Path to the PR template |

**Draft mode** is useful for CLI tools: the PR is created automatically but
requires manual review and approval before merging. This gives the team time to
verify the changelog, test the binary, and confirm the release is correct.

The **PR template** contains Release Summary, Changes, and Checklist sections.
Versionings auto-fills the version and type fields when creating the PR.

## Release Examples

### Initial release (minor)

First release of the CLI tool — a minor version with the initial set of subcommands:

```bash
# 1. Validate configuration
npm run validate

# 2. Preview the execution plan
npm run plan

# 3. Release
npm run release
# or directly:
npx versionings release --semver=minor --branch=release --push
```

Result:
- **Version:** `1.0.0` → `1.1.0`
- **Branch:** `release/1.1.x`
- **Tag:** `1.1.0`
- **PR:** Draft PR targeting `main` with template

### Subsequent patch release

Bug fix in the `count` subcommand — a patch within the existing release branch:

```bash
npx versionings release --semver=patch --branch=release --push
```

Result:
- **Version:** `1.1.0` → `1.1.1`
- **Branch:** `release/1.1.x` (reused)
- **Tag:** `1.1.1`
- **PR:** Draft PR targeting `main` with template

### Next minor release

Adding a new subcommand — a new minor release:

```bash
npx versionings release --semver=minor --branch=release --push
```

Result:
- **Version:** `1.1.1` → `1.2.0`
- **Branch:** `release/1.2.x` (new)
- **Tag:** `1.2.0`

## version.json Configuration

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/your-org/04-cli-tool.git",
    "branching": {
      "strategy": "release-branch"
    },
    "pr": {
      "target": "main",
      "draft": true,
      "template": ".github/PULL_REQUEST_TEMPLATE.md"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `git.platform` | SCM platform — `github` |
| `git.url` | Git repository URL |
| `git.branching.strategy` | Branching strategy — `release-branch` |
| `git.pr.target` | Target branch for Pull Requests |
| `git.pr.draft` | Create PRs as drafts |
| `git.pr.template` | Path to the PR template file |

## Prerequisites

- Node.js ≥ 18 and npm
- Git with a configured remote
- versionings installed: `npm install --global versionings`
- Replace `your-org` in `version.json` with your actual repository URL before using `--push`

## CI Pipeline

The `.github/workflows/release.yml` file automates releases on push to `main`.

### Pipeline Steps

1. **Checkout** with `fetch-depth: 0` — full commit history is required for
   versionings to analyze tags and branches
2. **Node.js 18** — runtime setup
3. **npm install** — install dependencies (including versionings)
4. **Validate** — verify configuration before releasing
5. **Release** — execute the release with flags:
   - `--semver=minor` — version bump type
   - `--branch=ci-release` — branch name for CI
   - `--push` — push to remote and create a draft PR
   - `--ci` — non-interactive mode (no prompts)
   - `--json` — structured JSON output for CI parsing

### Token

`GITHUB_TOKEN` is passed via GitHub Actions secrets (`${{ secrets.GITHUB_TOKEN }}`).
The built-in GitHub Actions token has permissions to push and create PRs within the
repository.

```yaml
- name: Release
  run: npx versionings release --semver=minor --branch=ci-release --push --ci --json
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Project Structure

```
04-cli-tool/
├── package.json              # npm package, bin field, validate/plan/release scripts
├── version.json              # versionings config: release-branch, draft PR
├── .gitignore                # node_modules/, dist/, .versionings/
├── README.md                 # This file
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md  # PR template: Release Summary, Changes, Checklist
│   └── workflows/
│       └── release.yml       # GitHub Actions: validate → release
└── src/
    ├── index.js              # yargs setup: scriptName, strictCommands, subcommands
    ├── commands/
    │   ├── greet.js          # greet subcommand: --name, --lang (en/ru/de)
    │   └── count.js          # count subcommand: <file> --words/--lines/--chars
    └── utils/
        └── format.js         # formatTable, formatJson, formatPlain
```

## Expected Result

Running `release --semver=minor` from version `1.0.0`:

- **Version:** `1.0.0` → `1.1.0`
- **Branch:** `release/1.1.x`
- **Tag:** `1.1.0`
- **PR:** Draft Pull Request targeting `main` with template from `.github/PULL_REQUEST_TEMPLATE.md`
- **Exit code:** `0` (success)
