# 10-enterprise-platform

Enterprise DDD platform demonstrating **all** advanced versionings features in a large-scale project.

## Project Overview

Express.js application with domain-driven design (DDD) architecture comprising three business domains:

- **Users** — registration, authentication, user profiles
- **Orders** — order creation, status state machine (pending → confirmed → shipped → delivered), inventory checks
- **Products** — product catalog with filtering, search, and inventory management

The shared layer provides JWT-like auth middleware, a centralized error handler, and a request validation utility.

## Branching Strategy: Git-Flow

Uses the `git-flow` strategy with explicit main and develop branches:

```json
{
  "git": {
    "branching": {
      "strategy": "git-flow",
      "mainBranch": "main",
      "developBranch": "develop"
    }
  }
}
```

- `main` — stable branch, contains only released versions
- `develop` — development branch, source for release branches
- Release branches are created from `develop` and merged into `main`
- Hotfix branches are created from `main` for emergency fixes

Git-flow enforces strict separation between development and production, which is critical for enterprise projects.

## SCM Platform: GitHub

Platform set to `github` with full PR automation. Token is provided via `GITHUB_TOKEN` in CI.

---

## Advanced Features

### Structured Logging

`logLevel: "info"` enables structured logging in JSON format:

```json
{
  "logLevel": "info"
}
```

Each versionings operation emits JSON lines to stderr:

```json
{"level":"info","msg":"Validating config","timestamp":"2025-01-15T10:00:00Z","operationId":"abc-123"}
{"level":"info","msg":"Bumping version to 1.2.0","timestamp":"2025-01-15T10:00:01Z","operationId":"abc-123"}
```

In CI, logs are redirected to a file for post-mortem analysis:

```bash
npx versionings release --semver=auto --push --ci --json 2>release-logs.jsonl 1>release-result.json
```

Available levels: `silent`, `error`, `warn`, `info`, `debug`.

### Operation IDs

Every versionings invocation generates a unique UUID — the Operation ID. It is included in all JSON log entries and in the execution result:

```json
{
  "operationId": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "version": "1.2.0"
}
```

Operation IDs enable correlation of all events from a single run in monitoring systems. In CI, the `release-logs.jsonl` artifact contains all logs sharing one operationId for end-to-end tracing.

### Concurrency Lock

`lockTimeoutMs: 600000` (10 minutes) prevents concurrent execution:

```json
{
  "lockTimeoutMs": 600000
}
```

- On startup, versionings creates a lock file in `.versionings/`
- If a lock already exists and has not expired, the operation waits or exits with an error
- Stale lock detection: if a lock is older than `lockTimeoutMs`, it is considered stale and reclaimed
- In CI, set this value higher than the maximum pipeline execution time

### --strict Mode

The `validate:strict` script runs validation in strict mode:

```bash
npm run validate:strict
# equivalent to: versionings validate --strict
```

In strict mode, versionings detects unknown fields in the configuration and reports them as errors. This catches typos and deprecated parameters:

```
ERROR: Unknown config field "git.braching" (did you mean "git.branching"?)
```

Always use `--strict` in CI for early detection of configuration issues.

### --print-config (Config Provenance)

The `config` script outputs the resolved configuration with the source of each value:

```bash
npm run config
# equivalent to: versionings release --print-config
```

Example output:

```
git.platform = "github"              (source: version.json)
git.branching.strategy = "git-flow"  (source: version.json)
logLevel = "info"                    (source: version.json)
```

Useful for debugging when configuration is assembled from multiple sources (CLI flags, env vars, version.json).

### Policy Checker

With the git-flow strategy, versionings automatically validates branching rules:

- Release branches must be created from `develop`
- Hotfix branches must be created from `main`
- Direct releases from `main` are not allowed

On policy violation — exit code `10` (POLICY_VIOLATION):

```
ERROR: Policy violation: git-flow requires release branches from "develop", current branch is "main"
```

### Custom Templates

Branch and tag naming templates with variable interpolation:

```json
{
  "git": {
    "branching": {
      "branchTemplate": "release/v{version}-{comment}",
      "tagTemplate": "v{version}"
    }
  }
}
```

Available variables:
- `{version}` — semantic version (e.g., `1.2.0`)
- `{comment}` — release comment in kebab-case

Example results:
- Branch: `release/v1.2.0-add-user-auth`
- Tag: `v1.2.0`

### Full PR Automation

All 6 PR automation parameters are configured:

```json
{
  "git": {
    "pr": {
      "target": "main",
      "reviewers": ["tech-lead", "security-reviewer", "qa-lead"],
      "labels": ["release", "enterprise", "automated"],
      "draft": false,
      "template": ".github/PULL_REQUEST_TEMPLATE.md",
      "milestone": "Q1-2025",
      "linkedIssues": ["#100", "#200", "#300"]
    }
  }
}
```

| Parameter | Description |
|-----------|-------------|
| `target` | Target branch for the PR |
| `reviewers` | Automatically assigned reviewers |
| `labels` | Labels applied to the PR |
| `draft` | Whether to create the PR as a draft |
| `template` | Path to the PR body template |
| `milestone` | Milestone to associate with the PR |
| `linkedIssues` | Issues linked to the PR |

The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) includes Summary, Changes, Checklist, and Rollback Plan sections.

### Conventional Commits

Extended conventional commits configuration with custom type mappings:

```json
{
  "conventionalCommits": {
    "enabled": true,
    "types": {
      "feat": "minor",
      "fix": "patch",
      "perf": "patch",
      "revert": "patch",
      "refactor": "patch",
      "deps": "patch",
      "security": "patch"
    },
    "fallbackBump": "patch"
  }
}
```

- `deps` — dependency updates → patch
- `security` — security fixes → patch
- `fallbackBump: "patch"` — if a commit type is unrecognized, patch is applied

With `--semver=auto`, versionings analyzes commits since the last tag and determines the bump level automatically.

### Changelog

Automatic changelog generation with grouping and filtering:

```json
{
  "changelog": {
    "file": "CHANGELOG.md",
    "groupTitles": {
      "feat": "✨ Features",
      "fix": "🐛 Bug Fixes",
      "perf": "⚡ Performance",
      "refactor": "♻️ Refactoring",
      "deps": "📦 Dependencies",
      "security": "🔒 Security"
    },
    "excludeTypes": ["chore", "ci", "test", "build", "style", "docs"],
    "includeNonConventional": false
  }
}
```

- `groupTitles` — section headings with emoji for each commit type
- `excludeTypes` — commit types excluded from the changelog (housekeeping)
- `includeNonConventional: false` — commits without conventional format are omitted

Manual generation:

```bash
npm run changelog
# equivalent to: versionings changelog --output CHANGELOG.md
```

### Rollback

Revert the last versionings operation:

```bash
npm run rollback
# equivalent to: versionings rollback
```

Versionings maintains an operation journal (LIFO). Rollback undoes the last mutation: deletes the created branch and tag, reverts the version in package.json. In CI, use with `--yes` for automatic confirmation:

```bash
versionings rollback --yes
```

### Doctor

Environment and configuration diagnostics:

```bash
npm run doctor
# equivalent to: versionings doctor
```

Doctor checks:
- Git and Node.js versions
- Configuration presence and validity
- Git remote accessibility
- Required SCM platform tokens
- Working tree state

---

## version.json Configuration

Full project configuration:

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/your-org/10-enterprise-platform.git",
    "branching": {
      "strategy": "git-flow",
      "mainBranch": "main",
      "developBranch": "develop",
      "branchTemplate": "release/v{version}-{comment}",
      "tagTemplate": "v{version}"
    },
    "pr": {
      "target": "main",
      "reviewers": ["tech-lead", "security-reviewer", "qa-lead"],
      "labels": ["release", "enterprise", "automated"],
      "draft": false,
      "template": ".github/PULL_REQUEST_TEMPLATE.md",
      "milestone": "Q1-2025",
      "linkedIssues": ["#100", "#200", "#300"]
    }
  },
  "conventionalCommits": {
    "enabled": true,
    "types": {
      "feat": "minor",
      "fix": "patch",
      "perf": "patch",
      "revert": "patch",
      "refactor": "patch",
      "deps": "patch",
      "security": "patch"
    },
    "fallbackBump": "patch"
  },
  "changelog": {
    "file": "CHANGELOG.md",
    "groupTitles": {
      "feat": "✨ Features",
      "fix": "🐛 Bug Fixes",
      "perf": "⚡ Performance",
      "refactor": "♻️ Refactoring",
      "deps": "📦 Dependencies",
      "security": "🔒 Security"
    },
    "excludeTypes": ["chore", "ci", "test", "build", "style", "docs"],
    "includeNonConventional": false
  },
  "logLevel": "info",
  "lockTimeoutMs": 600000
}
```

## CI Pipeline

GitHub Actions workflow (`.github/workflows/release.yml`) triggers on push to `develop`:

1. **Checkout** — full history (`fetch-depth: 0`) for commit analysis
2. **Validate (strict)** — strict configuration validation with `--strict --json`
3. **Print Config** — output provenance for audit trail
4. **Release** — automatic release with `--semver=auto --ci --json`
   - stdout (`release-result.json`) — operation result
   - stderr (`release-logs.jsonl`) — structured logs with operation ID
5. **Upload Logs** — `versionings-logs` artifact for post-mortem analysis

```yaml
- name: Validate config (strict)
  run: npx versionings validate --strict --json

- name: Print config provenance
  run: npx versionings release --print-config

- name: Release
  run: |
    npx versionings release --semver=auto --branch=enterprise-release --push --ci --json 2>release-logs.jsonl 1>release-result.json
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Upload structured logs
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: versionings-logs
    path: |
      release-logs.jsonl
      release-result.json
```

## Release Workflow

```bash
# 1. Validate configuration
npm run validate:strict

# 2. Inspect config provenance
npm run config

# 3. Run environment diagnostics
npm run doctor

# 4. Preview execution plan
npm run plan

# 5. Execute release
npm run release

# 6. If something goes wrong — rollback
npm run rollback
```

## Project Structure

```
10-enterprise-platform/
├── package.json
├── version.json
├── .gitignore
├── README.md
├── CHANGELOG.md
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       └── release.yml
└── src/
    ├── index.js
    ├── domains/
    │   ├── users/
    │   │   ├── users.service.js
    │   │   ├── users.model.js
    │   │   └── users.routes.js
    │   ├── orders/
    │   │   ├── orders.service.js
    │   │   ├── orders.model.js
    │   │   └── orders.routes.js
    │   └── products/
    │       ├── products.service.js
    │       ├── products.model.js
    │       └── products.routes.js
    └── shared/
        ├── middleware/
        │   ├── auth.js
        │   └── error-handler.js
        └── utils/
            └── validator.js
```
