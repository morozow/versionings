# versionings

A CLI tool that automates semantic versioning workflows for Git repositories. Handles version bumping, branch and tag creation, and optionally pushes changes and opens pull requests on GitHub or Bitbucket.

## Installation

```
npm install --global versionings
```

Requires Node.js >= 18.

## Quick Start

1. Create a `version.json` in your project root:

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/your-org/your-repo.git"
  }
}
```

2. Run:

```
versionings --semver=patch --branch=fix-login
```

This bumps the patch version, creates a version branch and tag, and commits the changes.

## Configuration

The `version.json` file is validated against a JSON Schema on every run. Invalid configuration produces clear error messages with field paths.

| Field | Required | Description |
|---|---|---|
| `git.platform` | Yes | VCS platform: `github` or `bitbucket` |
| `git.url` | Yes | Repository URL (HTTPS or SSH) |
| `git.pr.target` | No | Pull request target branch. Default: `master` |

The schema is exported as `version.schema.json` for IDE autocompletion.

## CLI Usage

```
versionings --semver=<type> --branch=<name> [options]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--semver` | string | required | Semver type: `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`, `prerelease` |
| `--branch` | string | required | Version branch comment (hyphen-case, max 96 chars, no `--`) |
| `--push` | boolean | `false` | Push branch and tags to remote, generate PR URL |
| `--preid` | string | — | Prerelease identifier (e.g. `beta`, `rc`) |
| `--dry-run` | boolean | `false` | Show the full execution plan without making changes |
| `--json` | boolean | `false` | Output results as structured JSON |
| `--verbose` | boolean | `false` | Log every shell command before execution |


## Workflow

1. Validate CLI arguments and configuration
2. Check working tree is clean (`git status --porcelain`)
3. Verify git remote matches `version.json`
4. Compute next version via `npm version` (probe + undo)
5. Check artifact uniqueness (branch and tag names, local + remote)
6. **Dry-run exits here** with the execution plan
7. Bump version (`npm version`)
8. Create branch (`version/<type>/<version>/<comment>`)
9. Create annotated tag (`<version>--<comment>`)
10. Commit all changes
11. Push + generate PR URL (if `--push`)

If any step 7–11 fails, all completed steps are automatically rolled back.

## Exit Codes

| Code | Name | Description |
|---|---|---|
| 0 | `SUCCESS` | Completed successfully |
| 1 | `CONFIG_ERROR` | Missing, invalid, or schema-violating `version.json` |
| 2 | `DIRTY_TREE` | Uncommitted or untracked files in working directory |
| 3 | `INVALID_ARGS` | Invalid `--semver` value or `--branch` format |
| 4 | `ARTIFACT_CONFLICT` | Branch or tag already exists (local or remote) |
| 5 | `COMMAND_FAILED` | Git or npm command returned non-zero exit code |
| 6 | `NETWORK_ERROR` | Remote repository or network failure |
| 7 | `INCOMPLETE_ROLLBACK` | Rollback could not fully revert; manual recovery needed |

## Reliability Features

### Dry Run

`--dry-run` executes all validation and checks, then outputs the full plan (version, branch, tag, commit message, commands) without modifying anything. Combine with `--json` for machine-readable output.

### JSON Output

`--json` produces a single JSON object to stdout (success) or stderr (error). No ANSI colors, no progress messages. Designed for CI script consumption.

Success:
```json
{
  "success": true,
  "version": "1.2.3",
  "previousVersion": "1.2.2",
  "semver": "patch",
  "branch": "version/patch/1.2.3/fix-login",
  "tag": "1.2.3--fix-login",
  "pullRequestUrl": null,
  "exitCode": 0
}
```

Error:
```json
{
  "success": false,
  "exitCode": 4,
  "error": {
    "code": "ARTIFACT_CONFLICT",
    "message": "Tag already exists: 1.2.3--fix-login",
    "details": { "type": "tag", "name": "1.2.3--fix-login", "scope": "local" }
  }
}
```

### Rollback

If a mutation step fails (version bump, branch creation, tagging, commit, push), all previously completed steps are automatically reversed in LIFO order. If rollback itself partially fails, the CLI exits with code 7 and prints manual recovery instructions.

### Artifact Uniqueness

Before any mutations, the tool checks that the target branch and tag names don't already exist — locally and (when `--push`) on the remote. Matching is by exact full name, not prefix or substring.


## Architecture

TypeScript source, bundled to a single `dist/version.js` via esbuild. Flat module layout:

| Module | Responsibility |
|---|---|
| `version.ts` | Thin CLI entry point (argument parsing, DI wiring, process exit) |
| `pipeline.ts` | Workflow orchestration (all stages as async sequence) |
| `executor.ts` | Centralized shell command execution with Promise API |
| `config.validator.ts` | JSON Schema validation of `version.json` via ajv |
| `rollback.ts` | LIFO rollback journal for mutation steps |
| `artifact.checker.ts` | Branch/tag uniqueness verification (local + remote) |
| `reporter.ts` | JSON and human-readable output formatting |
| `errors.ts` | `VersioningsError` class and `EXIT_CODES` constants |
| `version.utils.ts` | Branch/tag naming, PR URL generation, semver helpers |
| `utils.ts` | Legacy utilities (logging, ANSI colors, `get()`) |

All modules use dependency injection. The executor accepts a custom `execFn` for testing; the pipeline receives all dependencies through a `deps` parameter.

## Development

### Prerequisites

- Node.js >= 18
- npm

### Commands

```
npm install          # Install dependencies
npm run build        # Bundle to dist/version.js via esbuild
npm test             # Run all tests (unit, property, integration, e2e)
```

### Test Structure

```
__tests__/
├── unit/              # Module-level tests with mocks
├── properties/        # Property-based tests (fast-check, 100+ iterations each)
├── integration/       # Full pipeline with real git repos (no mocks)
├── e2e/               # CLI as child process with real git repos
└── helpers/           # Test utilities (repo fixture creation)
```

- **Unit tests**: Each public module has dedicated tests with mock dependencies
- **Property-based tests**: 16 correctness properties verified via fast-check (dry-run safety, rollback ordering, output normalization, JSON completeness, artifact matching, etc.)
- **Integration tests**: Full pipeline execution in isolated tmpdir git repositories with real executor, real filesystem, real git — no mocks
- **E2E tests**: `node dist/version.js` invoked as a child process against real git repos, verifying exit codes, stdout/stderr, and actual git state

### CI

GitHub Actions workflow (`.github/workflows/ci.yml`):
- Matrix: Node.js 18 + latest LTS
- Platforms: Ubuntu + macOS
- Steps: install → lint (ESLint) → unit tests → integration tests → e2e tests
- PR merge blocked on any failure

## License

MIT
