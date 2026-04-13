> **Navigation:** [Documentation Index](./index.md) · [Configuration Reference](./configuration-reference.md) · [CLI Reference](./cli-reference.md) · [Failure Matrix](./failure-matrix.md)

# Migration Guide

This guide covers upgrading Versionings across major feature phases. Each section describes what changed, lists new configuration fields and exit codes, and provides step-by-step migration instructions.

## P0 → P1: Subcommands and Configuration Hierarchy

P1 introduced a structured CLI with subcommands and a multi-source configuration system.

### What Changed

- **Subcommands**: The CLI now exposes dedicated subcommands: `init`, `validate`, `plan`, `release`, `rollback`, and `doctor`. Each subcommand has its own set of parameters and behavior.
- **Configuration hierarchy**: Configuration is loaded from 6 sources in order of ascending priority:
  1. Built-in defaults
  2. `version.json`
  3. RC files (`.versioningsrc`, `.versioningsrc.json`, `.versioningsrc.yml`, `.versioningsrc.yaml`)
  4. `"versionings"` key in `package.json`
  5. Environment variables with `VERSIONINGS_` prefix
  6. CLI flags
- **New exit codes**:
  - `8` (`NO_OPERATION`) — the requested operation had nothing to do (e.g., version already at target)
  - `9` (`USER_CANCELLED`) — the user cancelled an interactive prompt

### Migration Steps

1. Update any scripts that call `versionings` directly. The bare invocation `versionings --semver=<type> --branch=<name>` still works (it maps to `release`), but prefer explicit subcommands:

```bash
# Before (P0)
versionings --semver=patch --branch=my-feature

# After (P1) — explicit subcommand
versionings release --semver=patch --branch=my-feature
```

2. Review configuration sources. If you have settings in multiple places (e.g., `version.json` and environment variables), verify the [precedence order](./configuration-reference.md) produces the expected result:

```bash
versionings validate --json
```

3. Update CI scripts to handle new exit codes `8` and `9` in addition to `0`–`7`. See the [Failure Matrix](./failure-matrix.md) for details on each code.

4. Use `versionings doctor` to verify your environment is correctly configured:

```bash
versionings doctor
```

## P1 → P2: SCM Providers and PR/MR Automation

P2 added support for multiple SCM platforms and automated PR/MR creation via platform APIs.

### What Changed

- **New platforms**: In addition to `github` and `bitbucket`, Versionings now supports `github-enterprise`, `bitbucket-server`, `gitlab`, and `azure-devops`.
- **PR/MR creation via API**: The `--pr-mode` flag controls how pull requests are created:
  - `auto` — API call with fallback to browser URL
  - `api` — API only, fails if unavailable
  - `url` — Opens browser with pre-filled PR URL
- **New configuration fields**:
  - `git.apiUrl` — API endpoint for self-hosted platforms
  - `git.auth.token` — authentication token
  - `git.auth.method` — authentication method (`token` or `bearer`)
  - `git.api.timeout` — API request timeout in milliseconds (default: `30000`)
  - `git.pr.reviewers` — array of reviewer usernames
  - `git.pr.labels` — array of labels to apply
  - `git.pr.draft` — create PR as draft (default: `false`)
  - `git.pr.template` — path to PR body template file
  - `git.pr.milestone` — milestone to assign
  - `git.pr.linkedIssues` — array of issue identifiers to link

### Migration Steps

1. Set `git.platform` to match your SCM provider. For example, to switch from the default GitHub Cloud to GitLab:

```json
{
  "git": {
    "platform": "gitlab",
    "url": "https://gitlab.com/my-org/my-repo.git",
    "apiUrl": "https://gitlab.com/api/v4"
  }
}
```

2. Configure authentication. Provide a token via config, environment variable, or platform-specific variable:

```bash
# Option 1: Environment variable (recommended for CI)
export VERSIONINGS_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"

# Option 2: Platform-specific variable
export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
```

3. If you use PR automation, configure the desired PR parameters:

```json
{
  "git": {
    "platform": "gitlab",
    "url": "https://gitlab.com/my-org/my-repo.git",
    "pr": {
      "target": "main",
      "reviewers": ["alice", "bob"],
      "labels": ["release"],
      "draft": false
    }
  }
}
```

4. Validate the new configuration:

```bash
versionings validate --json
```

See the [SCM Provider Guide](./scm-provider-guide.md) for platform-specific setup instructions.

## P2 → P3: Branching Strategies and Policy Checker

P3 introduced pluggable branching strategies and a Policy Checker that validates branch names against strategy rules.

### What Changed

- **6 branching strategies**: `default`, `trunk-based`, `git-flow`, `release-branch`, `hotfix`, `maintenance`. Each strategy defines its own branch naming, tag naming, and allowed semver types.
- **New configuration section** `git.branching`:
  - `git.branching.strategy` — one of the 6 strategies (default: `default`)
  - `git.branching.branchTemplate` — custom branch name template
  - `git.branching.tagTemplate` — custom tag name template
  - `git.branching.mainBranch` — primary branch name (default: `master`)
  - `git.branching.developBranch` — development branch name (default: `develop`)
- **Policy Checker**: Validates that branch and tag names conform to the selected strategy before any mutation occurs.
- **New exit code**:
  - `10` (`POLICY_VIOLATION`) — a branch or tag name violates the active strategy's naming policy

### Migration Steps

1. Choose a branching strategy that matches your team's workflow. See the [Branch Strategy Cookbook](./branch-strategy-cookbook.md) for a comparison and examples.

2. Add the `git.branching` section to your configuration:

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/my-org/my-repo.git",
    "branching": {
      "strategy": "git-flow",
      "mainBranch": "main",
      "developBranch": "develop"
    }
  }
}
```

Equivalent YAML (`.versioningsrc.yml`):

```yaml
git:
  platform: github
  url: https://github.com/my-org/my-repo.git
  branching:
    strategy: git-flow
    mainBranch: main
    developBranch: develop
```

3. Run a dry-run to verify branch and tag naming under the new strategy:

```bash
versionings plan --semver=minor --branch=my-feature
```

4. Update CI scripts to handle exit code `10` (`POLICY_VIOLATION`). See the [Failure Matrix](./failure-matrix.md) for troubleshooting.

## P3 → P4: Conventional Commits and Changelog

P4 added Conventional Commits parsing, automatic semver bump detection, and changelog generation.

### What Changed

- **New subcommand**: `changelog` — generates a changelog from commit history.
- **Conventional Commits parsing**: Commit messages following the `<type>[(<scope>)][!]: <description>` format are parsed to determine the semver bump level automatically.
- **`--semver=auto`**: Analyzes commit history since the last tag and determines the appropriate bump (`major`, `minor`, or `patch`) based on conventional commit types and breaking change indicators.
- **New configuration sections**:
  - `conventionalCommits.enabled` — enable/disable parsing (default: `true`)
  - `conventionalCommits.types` — custom mapping of commit types to bump levels
  - `conventionalCommits.fallbackBump` — bump level when no conventional commits are found (default: `patch`)
  - `changelog.template` — changelog entry template
  - `changelog.groupTitles` — custom group headings by commit type
  - `changelog.excludeTypes` — commit types to exclude from changelog
  - `changelog.includeNonConventional` — include non-conventional commits (default: `false`)
  - `changelog.file` — path to changelog file for automatic updates on release
- **New exit code**:
  - `11` (`NO_CONVENTIONAL_COMMITS`) — `--semver=auto` was used but no conventional commits were found and `fallbackBump` is `null`

### Migration Steps

1. Enable Conventional Commits support (enabled by default). To customize the type-to-bump mapping:

```json
{
  "conventionalCommits": {
    "enabled": true,
    "types": {
      "feat": "minor",
      "fix": "patch",
      "perf": "patch",
      "refactor": "patch"
    },
    "fallbackBump": "patch"
  }
}
```

2. Configure changelog generation if desired:

```json
{
  "changelog": {
    "file": "CHANGELOG.md",
    "groupTitles": {
      "feat": "Features",
      "fix": "Bug Fixes",
      "perf": "Performance"
    },
    "excludeTypes": ["chore", "docs", "style"],
    "includeNonConventional": false
  }
}
```

3. Try automatic bump detection with a dry-run:

```bash
versionings plan --semver=auto --branch=my-feature
```

4. Generate a changelog preview:

```bash
versionings changelog --from=v1.0.0 --to=HEAD
```

5. Update CI scripts to handle exit code `11` (`NO_CONVENTIONAL_COMMITS`). See the [Failure Matrix](./failure-matrix.md) for details.

See the [Changelog Format Guide](./changelog-format-guide.md) for full configuration options.

## Backward Compatibility

Versionings maintains backward compatibility across all phase transitions:

### CLI Compatibility

The legacy invocation without a subcommand continues to work and is treated as `release`:

```bash
# Legacy syntax (still supported)
versionings --semver=patch --branch=my-feature

# Equivalent explicit syntax
versionings release --semver=patch --branch=my-feature
```

### Configuration Compatibility

A `version.json` file that only contains P0-era fields (e.g., `git.platform` and `git.url`) passes validation and works with default behavior. New configuration sections are optional:

- Without `git.branching` — the `default` strategy is used
- Without `conventionalCommits` — conventional commit parsing is enabled with default type mappings
- Without `changelog` — no changelog file is written on release

### Exit Code Compatibility

Exit codes are additive. Codes `0`–`7` from P0 retain their original meaning across all phases:

| Phase | Exit Codes | New Codes Added |
|-------|-----------|-----------------|
| P0    | 0–7       | —               |
| P1    | 0–9       | 8 (`NO_OPERATION`), 9 (`USER_CANCELLED`) |
| P3    | 0–10      | 10 (`POLICY_VIOLATION`) |
| P4    | 0–11      | 11 (`NO_CONVENTIONAL_COMMITS`) |

CI scripts that only check for exit code `0` (success) vs non-zero (failure) continue to work without changes.

## Post-Update Verification

After upgrading Versionings, run the following checks to verify everything works correctly:

### 1. Check Environment

```bash
versionings doctor
```

Confirms that Node.js, npm, Git, and the remote are properly configured.

### 2. Validate Configuration

```bash
versionings validate --json
```

Verifies that your configuration file is valid against the current schema and all required fields are present.

### 3. Dry-Run a Release

```bash
versionings plan --semver=patch --branch=test-migration
```

Runs the full release workflow without making any changes. Confirms that branching strategy, naming templates, and artifact checks work as expected.

### Verification Checklist

| Check | Command | Expected Outcome |
|-------|---------|-----------------|
| Environment health | `versionings doctor` | All checks pass |
| Config validity | `versionings validate --json` | Exit code `0`, no errors |
| Dry-run workflow | `versionings plan --semver=patch --branch=test` | Exit code `0`, plan output shown |
| Branch naming | Review `plan` output | Names match selected strategy |
| SCM authentication | `versionings validate --json` | No auth warnings |

If any check fails, consult the [Failure Matrix](./failure-matrix.md) for the corresponding exit code and resolution steps.
