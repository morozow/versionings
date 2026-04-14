# 05-monorepo-packages

Monorepo project with two packages demonstrating versionings integration with Bitbucket, YAML-based configuration, and the config hierarchy mechanism.

## Overview

The project is organized as a monorepo using npm workspaces. It contains two packages:

- **@monorepo/core** — object utility library: `deepMerge` (recursive merge), `cloneDeep` (deep clone via JSON serialization), `isEqual` (deep equality comparison).
- **@monorepo/logger** — structured JSON logger. The `createLogger(options)` factory returns an object with `info`, `warn`, `error`, and `debug` methods. Each method writes a JSON line containing `timestamp`, `level`, `message`, and optional `context` fields.

## Branching Strategy

Uses the **default** strategy — the simplest strategy available in versionings. On release, a branch `version/patch/<version>/<comment>` is created from the current branch with no restrictions on the source branch. Suitable for monorepo projects where releases are performed from the main branch.

## SCM Platform

The project targets **Bitbucket** (`git.platform: bitbucket`). Pull requests are opened against the `main` branch. The `BITBUCKET_TOKEN` must be configured as a secured repository variable under Bitbucket Settings → Repository variables.

## YAML Configuration (.versioningsrc.yml)

The primary versionings configuration lives in `.versioningsrc.yml` at the project root:

```yaml
git:
  platform: bitbucket
  url: https://bitbucket.org/your-workspace/05-monorepo-packages.git
  branching:
    strategy: default
  pr:
    target: main
```

Fields:
- `git.platform` — SCM platform (`bitbucket`)
- `git.url` — repository URL
- `git.branching.strategy` — branching strategy (`default`)
- `git.pr.target` — pull request target branch (`main`)

## Config Hierarchy

Versionings loads configuration from multiple sources. Priority (highest to lowest):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | CLI flags | Command-line flags (`--semver`, `--branch`, etc.) |
| 2 | Environment variables | `VERSIONINGS_*` environment variables |
| 3 | `version.json` | Primary configuration file |
| 4 | `.versioningsrc` / `.versioningsrc.yml` | Alternative configuration file |
| 5 (lowest) | `package.json#versionings` | `"versionings"` section in package.json |

Higher-priority sources overwrite values from lower-priority sources. Nested objects are merged recursively.

### package.json#versionings Override Example

In this project, the `@monorepo/core` package declares a `"versionings"` section in its `package.json`:

```json
{
  "name": "@monorepo/core",
  "version": "1.0.0",
  "main": "src/index.js",
  "versionings": {
    "git": {
      "pr": {
        "target": "develop"
      }
    }
  }
}
```

The root `.versioningsrc.yml` sets `git.pr.target: main` (priority 4). The core package's `package.json#versionings` attempts to override it with `develop` (priority 5 — lower). Because `.versioningsrc.yml` has higher priority, the resolved value of `git.pr.target` remains `main`.

To override a value from `.versioningsrc.yml`, use a higher-priority source — CLI flags or environment variables.

## Environment Variable Overrides (VERSIONINGS_*)

Any configuration field can be overridden via environment variables prefixed with `VERSIONINGS_`. Nesting is expressed with `_`:

| Variable | Config equivalent |
|----------|-------------------|
| `VERSIONINGS_GIT_PLATFORM` | `git.platform` |
| `VERSIONINGS_GIT_PR_TARGET` | `git.pr.target` |
| `VERSIONINGS_GIT_BRANCHING_STRATEGY` | `git.branching.strategy` |

Example usage in CI:

```bash
VERSIONINGS_GIT_PR_TARGET=develop npx versionings validate --json
```

Environment variables have priority 2 (higher than `version.json`, `.versioningsrc.yml`, and `package.json#versionings`), so they are guaranteed to overwrite values from configuration files.

## Bitbucket Pipelines CI

The CI pipeline is defined in `bitbucket-pipelines.yml`. It triggers on pushes to the `main` branch:

```yaml
image: node:18

pipelines:
  branches:
    main:
      - step:
          name: Validate and Release
          script:
            - npm install
            - npx versionings validate --json
            - npx versionings release --semver=patch --branch=ci-release --push --ci --json
          caches:
            - node
```

Flags:
- `--ci` — non-interactive mode, suppresses all interactive prompts
- `--json` — structured JSON output for CI script consumption
- `--push` — automatically pushes changes and creates a pull request

The `BITBUCKET_TOKEN` must be configured in Bitbucket Settings → Repository settings → Repository variables as a secured variable.

## Release Workflow

```bash
# 1. Install dependencies
npm install

# 2. Validate configuration
npm run validate

# 3. Preview the release plan (dry-run)
npm run plan

# 4. Execute the release
npm run release
```

## Project Structure

```
05-monorepo-packages/
├── package.json                    # Root package (workspaces)
├── .versioningsrc.yml              # Versionings configuration (YAML)
├── .gitignore
├── README.md
├── bitbucket-pipelines.yml         # Bitbucket Pipelines CI
└── packages/
    ├── core/
    │   ├── package.json            # Includes "versionings" section (config hierarchy)
    │   └── src/
    │       └── index.js            # deepMerge, cloneDeep, isEqual
    └── logger/
        ├── package.json
        └── src/
            └── index.js            # createLogger → info, warn, error, debug
```
