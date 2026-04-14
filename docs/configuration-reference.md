> **Navigation:** [Documentation Index](./index.md) · [CLI Reference](./cli-reference.md) · [Branch Strategy Cookbook](./branch-strategy-cookbook.md) · [SCM Provider Guide](./scm-provider-guide.md) · [Changelog Format Guide](./changelog-format-guide.md)

# Configuration Reference

Versionings loads configuration from multiple sources, merges them with a well-defined priority order, and validates the result against a JSON Schema. This document describes every configuration field, all supported sources, environment variable mappings, and advanced features like Config Provenance and strict mode.

## Configuration Sources

Configuration is collected from six sources. When the same field appears in more than one source, the higher-priority source wins. Sources are listed below from lowest to highest priority:

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (lowest) | Built-in defaults | Hard-coded values shipped with the CLI |
| 2 | `version.json` | Project-level JSON config file in the repository root |
| 3 | RC files | `.versioningsrc`, `.versioningsrc.json`, `.versioningsrc.yml`, or `.versioningsrc.yaml` in the repository root |
| 4 | `package.json` | The `"versionings"` key inside `package.json` |
| 5 | Environment variables | Variables prefixed with `VERSIONINGS_` |
| 6 (highest) | CLI arguments | Flags and options passed on the command line |

If multiple RC files are present, only the first one found (in the order listed above) is used; the rest are ignored with a warning.

## Configuration Fields

The table below lists every configuration field. Dot-notation paths correspond to nested JSON keys (e.g., `git.pr.target` means `{ "git": { "pr": { "target": "..." } } }`).

| Path | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `git.platform` | string (enum) | — | Yes | SCM platform: `github`, `github-enterprise`, `bitbucket`, `bitbucket-server`, `gitlab`, `azure-devops` |
| `git.url` | string | — | Yes | Repository URL (HTTPS or SSH) |
| `git.apiUrl` | string | — | Conditional | API base URL for self-hosted platforms. Required when `platform` is `github-enterprise` or `bitbucket-server` |
| `git.remote` | string | `origin` | No | Git remote name |
| `git.branchType.version` | string | `version` | No | Branch type prefix used in branch naming |
| `git.pr.target` | string | `master` | No | Default target branch for pull requests |
| `git.pr.reviewers` | string[] | — | No | List of reviewer usernames for PRs |
| `git.pr.labels` | string[] | — | No | Labels to apply to PRs |
| `git.pr.draft` | boolean | `false` | No | Create PR as draft |
| `git.pr.template` | string | — | No | Path to PR body template file |
| `git.pr.milestone` | string | — | No | Milestone to associate with the PR |
| `git.pr.linkedIssues` | string[] | — | No | Issue identifiers to link to the PR |
| `git.auth.token` | string | — | No | Authentication token for SCM API calls |
| `git.auth.method` | string (enum) | `token` | No | Auth method: `token` or `bearer` |
| `git.api.timeout` | integer | `30000` | No | API request timeout in milliseconds (1000–120000) |
| `git.limits.branchMaxCommentLength` | integer | `96` | No | Maximum length of the branch comment segment |
| `git.commit.message.semver.patch` | string | `Patch: v%s. You SHOULD consider changes.` | No | Commit message template for patch bumps |
| `git.commit.message.semver.minor` | string | `Minor: v%s. You MUST consider changes.` | No | Commit message template for minor bumps |
| `git.commit.message.semver.major` | string | `Release: v%s.` | No | Commit message template for major bumps |
| `git.commit.message.semver.prepatch` | string | `Patch version is preparing now: v%s.` | No | Commit message template for prepatch bumps |
| `git.commit.message.semver.preminor` | string | `Minor version is preparing now: v%s.` | No | Commit message template for preminor bumps |
| `git.commit.message.semver.premajor` | string | `Release is preparing now: v%s.` | No | Commit message template for premajor bumps |
| `git.commit.message.semver.prerelease` | string | `Preparing: v%s.` | No | Commit message template for prerelease bumps |
| `git.branching.strategy` | string (enum) | `default` | No | Branching strategy: `default`, `trunk-based`, `git-flow`, `release-branch`, `hotfix`, `maintenance` |
| `git.branching.branchTemplate` | string | — | No | Custom branch naming template |
| `git.branching.tagTemplate` | string | — | No | Custom tag naming template |
| `git.branching.mainBranch` | string | `master` | No | Main branch name |
| `git.branching.developBranch` | string | `develop` | No | Development branch name (used by git-flow) |
| `conventionalCommits.enabled` | boolean | `true` | No | Enable Conventional Commits parsing |
| `conventionalCommits.types` | object | See below | No | Mapping of commit type to bump level |
| `conventionalCommits.fallbackBump` | string \| null | `null` | No | Bump level when no conventional commits found: `patch`, `minor`, `major`, or `null` |
| `changelog.template` | string | — | No | Custom changelog template |
| `changelog.groupTitles` | object | — | No | Mapping of commit type to changelog group heading |
| `changelog.excludeTypes` | string[] | — | No | Commit types to exclude from changelog |
| `changelog.includeNonConventional` | boolean | `false` | No | Include non-conventional commits in changelog |
| `changelog.file` | string | — | No | Path to changelog file for automatic updates on release |
| `logLevel` | string (enum) | `warn` | No | Log verbosity: `debug`, `info`, `warn`, `error` |
| `lockTimeoutMs` | integer | `300000` | No | Lock acquisition timeout in milliseconds |

## Section: git

The `git` section contains all repository and SCM platform settings.

### git.platform

SCM platform identifier. Determines which API client is used for PR creation and remote operations.

| Value | Platform |
|-------|----------|
| `github` | GitHub Cloud (github.com) |
| `github-enterprise` | GitHub Enterprise Server (self-hosted) |
| `bitbucket` | Bitbucket Cloud (bitbucket.org) |
| `bitbucket-server` | Bitbucket Server / Data Center (self-hosted) |
| `gitlab` | GitLab (Cloud or self-hosted) |
| `azure-devops` | Azure DevOps Services / Server |

### git.url

Repository URL in HTTPS or SSH format. Used to identify the repository and construct API endpoints.

```bash
# HTTPS
https://github.com/my-org/my-repo.git

# SSH
git@github.com:my-org/my-repo.git
```

### git.apiUrl

API base URL for self-hosted platforms. Required when `git.platform` is `github-enterprise` or `bitbucket-server`. Must start with `http://` or `https://`.

```json
{
  "git": {
    "platform": "github-enterprise",
    "url": "https://github.example.com/my-org/my-repo.git",
    "apiUrl": "https://github.example.com/api/v3"
  }
}
```

### git.remote

Name of the Git remote. Default: `origin`.

### git.branchType.version

Branch type prefix used in the default branch naming pattern `{branchType}/{semver}/{version}/{comment}`. Default: `version`.

### git.pr

Pull request configuration fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `target` | string | `master` | Target branch for PRs |
| `reviewers` | string[] | — | Reviewer usernames |
| `labels` | string[] | — | PR labels |
| `draft` | boolean | `false` | Create as draft PR |
| `template` | string | — | Path to PR body template file |
| `milestone` | string | — | Milestone name or ID |
| `linkedIssues` | string[] | — | Issue references to link |

### git.auth

Authentication settings for SCM API calls:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `token` | string | — | Authentication token |
| `method` | enum | `token` | Auth method: `token` (header-based) or `bearer` (Authorization: Bearer) |

See the [SCM Provider Guide](./scm-provider-guide.md) for platform-specific token setup.

### git.api

API client settings:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | integer | `30000` | Request timeout in milliseconds. Valid range: 1000–120000 |

### git.limits

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `branchMaxCommentLength` | integer | `96` | Maximum character length for the branch comment segment |

### git.commit.message.semver

Commit message templates for each semver bump type. Use `%s` as a placeholder for the version number.

| Field | Default |
|-------|---------|
| `patch` | `Patch: v%s. You SHOULD consider changes.` |
| `minor` | `Minor: v%s. You MUST consider changes.` |
| `major` | `Release: v%s.` |
| `prepatch` | `Patch version is preparing now: v%s.` |
| `preminor` | `Minor version is preparing now: v%s.` |
| `premajor` | `Release is preparing now: v%s.` |
| `prerelease` | `Preparing: v%s.` |

## Section: git.branching

The `git.branching` section controls which branching strategy is used and how branches and tags are named. See the [Branch Strategy Cookbook](./branch-strategy-cookbook.md) for detailed workflow descriptions and examples for each strategy.

### git.branching.strategy

Branching strategy to use. Each strategy defines its own rules for branch creation, allowed semver types, and naming conventions.

| Value | Description |
|-------|-------------|
| `default` | Standard version branch workflow (default) |
| `trunk-based` | All changes land on the main branch |
| `git-flow` | Feature/develop/release/hotfix branch model |
| `release-branch` | Long-lived release branches |
| `hotfix` | Emergency fix workflow from main branch |
| `maintenance` | Parallel maintenance of older release lines |

### git.branching.branchTemplate

Custom branch naming template. Overrides the strategy's default branch name format. Available variables: `{version}`, `{major}`, `{minor}`, `{patch}`, `{semver}`, `{comment}`, `{branchType}`.

```json
{
  "git": {
    "branching": {
      "branchTemplate": "release/{version}"
    }
  }
}
```

### git.branching.tagTemplate

Custom tag naming template. Overrides the strategy's default tag format. Available variables: `{version}`, `{major}`, `{minor}`, `{patch}`, `{semver}`, `{comment}`, `{branchType}`.

```json
{
  "git": {
    "branching": {
      "tagTemplate": "v{version}"
    }
  }
}
```

### git.branching.mainBranch

Name of the main (production) branch. Default: `master`.

### git.branching.developBranch

Name of the development branch, used by the `git-flow` strategy. Default: `develop`.

## Section: conventionalCommits

The `conventionalCommits` section controls how commit messages are parsed and how version bumps are determined from commit history.

### conventionalCommits.enabled

Enable or disable Conventional Commits parsing. When enabled, commit messages following the `<type>[(<scope>)][!]: <description>` format are analyzed to determine the appropriate version bump. Default: `true`.

### conventionalCommits.types

Object mapping commit type strings to bump levels. Each key is a commit type (e.g., `feat`, `fix`) and each value is one of `major`, `minor`, `patch`, or `none`.

Default mapping:

| Type | Bump Level |
|------|-----------|
| `feat` | `minor` |
| `fix` | `patch` |
| `perf` | `patch` |
| `revert` | `patch` |
| `chore` | `none` |
| `docs` | `none` |
| `style` | `none` |
| `refactor` | `none` |
| `test` | `none` |
| `build` | `none` |
| `ci` | `none` |

You can override individual types or add new ones:

```json
{
  "conventionalCommits": {
    "types": {
      "refactor": "patch",
      "deps": "patch"
    }
  }
}
```

### conventionalCommits.fallbackBump

Bump level to use when `--semver=auto` finds no conventional commits in the range. Accepts `patch`, `minor`, `major`, or `null`. When set to `null`, the operation exits with code 11 (`NO_CONVENTIONAL_COMMITS`) if no conventional commits are found. Default: `null`.

See the [Changelog Format Guide](./changelog-format-guide.md) for more on Conventional Commits configuration.

## Section: changelog

The `changelog` section controls changelog generation behavior.

### changelog.template

Custom template string for changelog output. When not set, the built-in template is used.

### changelog.groupTitles

Object mapping commit types to human-readable group headings in the changelog.

```json
{
  "changelog": {
    "groupTitles": {
      "feat": "Features",
      "fix": "Bug Fixes",
      "perf": "Performance Improvements",
      "revert": "Reverts",
      "docs": "Documentation",
      "refactor": "Code Refactoring"
    }
  }
}
```

### changelog.excludeTypes

Array of commit types to exclude from the generated changelog.

```json
{
  "changelog": {
    "excludeTypes": ["chore", "ci", "test", "build", "style"]
  }
}
```

### changelog.includeNonConventional

When `true`, commits that do not follow the Conventional Commits format are included in the changelog under a separate group. Default: `false`.

### changelog.file

Path to a changelog file that is automatically updated during `release`. When set, the generated changelog is prepended to this file.

```json
{
  "changelog": {
    "file": "CHANGELOG.md"
  }
}
```

See the [Changelog Format Guide](./changelog-format-guide.md) for detailed changelog configuration examples.

## Environment Variables

Environment variables with the `VERSIONINGS_` prefix map to configuration fields. They have priority 5 (above file-based sources, below CLI arguments).

| Environment Variable | Config Path |
|---|---|
| `VERSIONINGS_GIT_PLATFORM` | `git.platform` |
| `VERSIONINGS_GIT_URL` | `git.url` |
| `VERSIONINGS_GIT_PR_TARGET` | `git.pr.target` |
| `VERSIONINGS_GIT_REMOTE` | `git.remote` |
| `VERSIONINGS_GIT_BRANCH_TYPE_VERSION` | `git.branchType.version` |
| `VERSIONINGS_GIT_API_URL` | `git.apiUrl` |
| `VERSIONINGS_GIT_AUTH_TOKEN` | `git.auth.token` |
| `VERSIONINGS_GIT_API_TIMEOUT` | `git.api.timeout` |
| `VERSIONINGS_GIT_BRANCHING_STRATEGY` | `git.branching.strategy` |
| `VERSIONINGS_GIT_BRANCHING_MAIN_BRANCH` | `git.branching.mainBranch` |
| `VERSIONINGS_GIT_BRANCHING_DEVELOP_BRANCH` | `git.branching.developBranch` |
| `VERSIONINGS_CONVENTIONAL_COMMITS_ENABLED` | `conventionalCommits.enabled` |
| `VERSIONINGS_CONVENTIONAL_COMMITS_FALLBACK_BUMP` | `conventionalCommits.fallbackBump` |
| `VERSIONINGS_LOG_LEVEL` | `logLevel` |
| `VERSIONINGS_LOCK_TIMEOUT_MS` | `lockTimeoutMs` |

Boolean variables accept `true` or `false` (case-insensitive). The special value `null` for `VERSIONINGS_CONVENTIONAL_COMMITS_FALLBACK_BUMP` is passed as the literal string `null`. Numeric variables (e.g., `VERSIONINGS_LOCK_TIMEOUT_MS`) are automatically coerced to integers.

Only the variables listed above are recognized. Unknown `VERSIONINGS_*` variables are ignored in default mode and produce errors in strict mode (see [Unknown Keys Policy](#unknown-keys-policy)).

## Full Configuration Example

### JSON

A complete `version.json` configuration:

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/my-org/my-repo.git",
    "remote": "origin",
    "pr": {
      "target": "main",
      "reviewers": ["alice", "bob"],
      "labels": ["release"],
      "draft": false
    },
    "branching": {
      "strategy": "git-flow",
      "mainBranch": "main",
      "developBranch": "develop"
    },
    "commit": {
      "message": {
        "semver": {
          "patch": "fix: bump to v%s",
          "minor": "feat: bump to v%s",
          "major": "release: v%s",
          "prepatch": "pre-patch: v%s",
          "preminor": "pre-minor: v%s",
          "premajor": "pre-major: v%s",
          "prerelease": "prerelease: v%s"
        }
      }
    }
  },
  "conventionalCommits": {
    "enabled": true,
    "types": {
      "feat": "minor",
      "fix": "patch",
      "perf": "patch",
      "revert": "patch",
      "chore": "none",
      "docs": "none",
      "style": "none",
      "refactor": "none",
      "test": "none",
      "build": "none",
      "ci": "none"
    },
    "fallbackBump": "patch"
  },
  "changelog": {
    "file": "CHANGELOG.md",
    "groupTitles": {
      "feat": "Features",
      "fix": "Bug Fixes",
      "perf": "Performance"
    },
    "excludeTypes": ["chore", "ci", "test"],
    "includeNonConventional": false
  }
}
```

### YAML

The equivalent configuration as `.versioningsrc.yml`:

```yaml
git:
  platform: github
  url: https://github.com/my-org/my-repo.git
  remote: origin
  pr:
    target: main
    reviewers:
      - alice
      - bob
    labels:
      - release
    draft: false
  branching:
    strategy: git-flow
    mainBranch: main
    developBranch: develop
  commit:
    message:
      semver:
        patch: "fix: bump to v%s"
        minor: "feat: bump to v%s"
        major: "release: v%s"
        prepatch: "pre-patch: v%s"
        preminor: "pre-minor: v%s"
        premajor: "pre-major: v%s"
        prerelease: "prerelease: v%s"

conventionalCommits:
  enabled: true
  types:
    feat: minor
    fix: patch
    perf: patch
    revert: patch
    chore: none
    docs: none
    style: none
    refactor: none
    test: none
    build: none
    ci: none
  fallbackBump: patch

changelog:
  file: CHANGELOG.md
  groupTitles:
    feat: Features
    fix: Bug Fixes
    perf: Performance
  excludeTypes:
    - chore
    - ci
    - test
  includeNonConventional: false
```

## Config Provenance

Use the `--print-config` flag to display the fully resolved configuration along with the source of each field. This is useful for debugging which source is providing a particular value.

```bash
versionings release --print-config
```

Example output:

```json
{
  "git.platform": {
    "value": "github",
    "source": "version.json"
  },
  "git.url": {
    "value": "https://github.com/my-org/my-repo.git",
    "source": "version.json"
  },
  "git.remote": {
    "value": "origin",
    "source": "defaults"
  },
  "git.pr.target": {
    "value": "main",
    "source": "env"
  },
  "git.branching.strategy": {
    "value": "git-flow",
    "source": "cli"
  }
}
```

Each field shows its resolved `value` and the `source` that provided it. Possible source names:

| Source | Meaning |
|--------|---------|
| `defaults` | Built-in default value |
| `version.json` | Loaded from `version.json` |
| `.versioningsrc` | Loaded from an RC file (also `.versioningsrc.json`, `.versioningsrc.yml`, `.versioningsrc.yaml`) |
| `package.json#versionings` | Loaded from the `"versionings"` key in `package.json` |
| `env` | Set via a `VERSIONINGS_*` environment variable |
| `cli` | Passed as a CLI argument |

See the [CLI Reference](./cli-reference.md) for details on the `--print-config` flag.

## Unknown Keys Policy

By default, unrecognized keys in configuration files produce a warning but do not prevent execution. This allows forward-compatible configs where newer fields are ignored by older CLI versions.

In strict mode, unknown keys cause a validation error (exit code 1, `CONFIG_ERROR`). Strict mode is activated by either:

- The `--strict` CLI flag:

```bash
versionings validate --strict
```

- The `VERSIONINGS_STRICT` environment variable:

```bash
VERSIONINGS_STRICT=true versionings validate
```

Strict mode is recommended for CI environments to catch configuration typos early.

## JSON Schema

The configuration is validated at runtime against `version.schema.json` using [Ajv](https://ajv.js.org/). You can use this schema in your IDE for autocompletion and inline validation.

For VS Code, add to your `.vscode/settings.json`:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["version.json", ".versioningsrc.json"],
      "url": "./node_modules/versionings/version.schema.json"
    }
  ]
}
```

For JetBrains IDEs (WebStorm, IntelliJ), map the schema to `version.json` via Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings.

The schema enforces:
- Required fields: `git.platform` and `git.url`
- Enum constraints on `git.platform`, `git.branching.strategy`, `git.auth.method`, `conventionalCommits.fallbackBump`, and `logLevel`
- Conditional requirement: `git.apiUrl` is required when `git.platform` is `github-enterprise` or `bitbucket-server`
- Type constraints: integers for timeouts and limits, booleans for flags, arrays for lists
- No additional properties at the top level or within `conventionalCommits`, `changelog`, `git.auth`, `git.api`, and `git.branching` sections
