> **Navigation:** [Documentation Index](./index.md) · [Configuration Reference](./configuration-reference.md) · [CLI Reference](./cli-reference.md)

# Changelog Format Guide

Versionings supports Conventional Commits for automatic version bump detection and structured changelog generation. This guide covers the commit message format, bump policy configuration, auto-bump behavior, and changelog output options.

## Conventional Commits Format

Versionings follows the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/) specification. Each commit message follows this structure:

```text
<type>[(<scope>)][!]: <description>
```

| Component | Required | Description |
|-----------|----------|-------------|
| `type` | Yes | Category of the change (e.g., `feat`, `fix`). Determines the default version bump level. |
| `scope` | No | Parenthesized string identifying the section of the codebase affected (e.g., `auth`, `cli`). |
| `!` | No | Breaking change indicator. Placed after the scope (or type if no scope). Forces a `major` bump. |
| `description` | Yes | Short summary of the change. Follows the colon and space after the type/scope. |

Examples:

```text
feat: add search functionality
fix(auth): resolve token refresh on expiry
feat!: redesign public API endpoints
refactor(cli): simplify command routing
docs: update setup guide
feat(parser)!: change AST node format
```

A commit may also indicate a breaking change via a `BREAKING CHANGE` footer in the commit body, which has the same effect as the `!` indicator.

## Commit Types

Standard commit types recognized by Versionings and their default bump levels:

| Type | Description | Default Bump |
|------|-------------|-------------|
| `feat` | New feature | `minor` |
| `fix` | Bug fix | `patch` |
| `perf` | Performance improvement | `patch` |
| `revert` | Revert a previous commit | `patch` |
| `chore` | Maintenance task | `none` |
| `docs` | Documentation change | `none` |
| `style` | Code style change | `none` |
| `refactor` | Code refactoring | `none` |
| `test` | Test addition or modification | `none` |
| `build` | Build system change | `none` |
| `ci` | CI configuration change | `none` |

Types mapped to `none` do not trigger a version bump on their own and are excluded from the changelog by default.

Breaking changes (indicated by `!` or a `BREAKING CHANGE` footer) always trigger a `major` bump regardless of the commit type.

## Bump Policy

The `conventionalCommits.types` configuration field controls the mapping from commit type to bump level. You can override default mappings or add custom types.

Override `refactor` to trigger a `patch` bump and add a custom `deps` type:

```json
{
  "conventionalCommits": {
    "enabled": true,
    "types": {
      "refactor": "patch",
      "deps": "patch"
    }
  }
}
```

YAML equivalent:

```yaml
conventionalCommits:
  enabled: true
  types:
    refactor: patch
    deps: patch
```

Custom types are merged with the built-in defaults. Only the types you specify are overridden; all other types retain their default bump levels.

Valid bump levels: `major`, `minor`, `patch`, `none`.

See [Configuration Reference — conventionalCommits](./configuration-reference.md) for the full field specification.

## Auto Bump

When you pass `--semver=auto`, Versionings analyzes the commit history since the last version tag and determines the appropriate bump level automatically.

How it works:

1. Versionings finds the most recent version tag in the repository.
2. All commits between that tag and `HEAD` are parsed as Conventional Commits.
3. Each commit's type is mapped to a bump level using the configured bump policy.
4. Breaking changes (`!` or `BREAKING CHANGE` footer) are mapped to `major`.
5. The highest bump wins: `major` > `minor` > `patch`.

```bash
versionings release --semver=auto --branch=next-release --ci
```

### Fallback Behavior

When no conventional commits are found in the range (all commits are non-conventional), the `conventionalCommits.fallbackBump` setting determines what happens.

Set fallback to `patch` — a patch bump is applied when no conventional commits are found:

```json
{
  "conventionalCommits": {
    "enabled": true,
    "fallbackBump": "patch"
  }
}
```

Set fallback to `null` (default) — the command fails with exit code 11 (`NO_CONVENTIONAL_COMMITS`) when no conventional commits are found:

```json
{
  "conventionalCommits": {
    "enabled": true,
    "fallbackBump": null
  }
}
```

Valid fallback values: `"patch"`, `"minor"`, `"major"`, `null`.

When `fallbackBump` is `null` and no conventional commits exist, `--semver=auto` exits with code 11. See [Failure Matrix](./failure-matrix.md) for troubleshooting this exit code.

## Changelog Configuration

The `changelog` section in your configuration controls how changelogs are generated and formatted.

### `changelog.file`

Path to the changelog file for automatic updates during release. When set, the generated changelog is prepended to this file during `versionings release`.

```json
{
  "changelog": {
    "file": "CHANGELOG.md"
  }
}
```

### `changelog.groupTitles`

Maps commit types to section headings in the generated changelog. Default titles are provided for common types.

```json
{
  "changelog": {
    "groupTitles": {
      "breaking": "BREAKING CHANGES",
      "feat": "Features",
      "fix": "Bug Fixes",
      "perf": "Performance Improvements",
      "revert": "Reverts",
      "deps": "Dependency Updates"
    }
  }
}
```

### `changelog.excludeTypes`

Array of commit types to exclude from the changelog. Types mapped to `none` in the bump policy are excluded automatically.

```json
{
  "changelog": {
    "excludeTypes": ["chore", "ci"]
  }
}
```

### `changelog.includeNonConventional`

Boolean flag controlling whether commits that do not follow the Conventional Commits format are included in the changelog under an "Other Changes" group. Defaults to `false`.

```json
{
  "changelog": {
    "includeNonConventional": true
  }
}
```

## Generating Changelog

The `versionings changelog` subcommand generates a changelog from commit history without modifying the repository.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--from` | string | Last version tag | Starting point (tag or commit SHA) |
| `--to` | string | `HEAD` | Ending point (tag, branch, or commit SHA) |
| `--output` | string | — | Write changelog to a file instead of stdout |
| `--format` | string | `markdown` | Output format: `markdown` or `plain` |
| `--json` | boolean | `false` | Output structured JSON with groups and metadata |

### Examples

Generate changelog to stdout (from last tag to HEAD):

```bash
versionings changelog
```

Write changelog to a file:

```bash
versionings changelog --output CHANGELOG.md
```

Generate changelog for a specific range:

```bash
versionings changelog --from v1.2.0 --to v1.3.0
```

Generate plain text output:

```bash
versionings changelog --format plain
```

Generate structured JSON output:

```bash
versionings changelog --json
```

When writing to an existing file with `--output`, the new changelog section is inserted after the `# Changelog` header, preserving previous entries.

See [CLI Reference — changelog](./cli-reference.md) for the full command specification.

## Automatic Changelog on Release

When `changelog.file` is set in your configuration, Versionings automatically generates and prepends a changelog entry to the specified file during `versionings release`.

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/user/repo"
  },
  "changelog": {
    "file": "CHANGELOG.md"
  }
}
```

During release, the generated section is prepended to the file content. If the file does not exist, it is created. The changelog entry includes the new version number and the release date.

This happens as part of the release workflow — no separate `versionings changelog` invocation is needed.

---

See [Configuration Reference](./configuration-reference.md) for the full specification of `conventionalCommits` and `changelog` fields. See [CLI Reference](./cli-reference.md) for all `changelog` subcommand parameters and global flags.
