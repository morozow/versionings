# versionings

CLI tool that automates semantic versioning workflows for Git repositories. Bumps versions, creates branches and tags, and optionally pushes changes and opens pull requests on supported SCM platforms.

## Installation

```bash
npm install --global versionings
```

Requires Node.js >= 18.

## Quick Start

```bash
# Create a configuration file
versionings init

# Preview what will happen (dry-run)
versionings plan --semver=patch --branch=my-feature

# Execute the versioning workflow
versionings release --semver=patch --branch=my-feature
```

See the [Setup Guide](docs/setup-guide.md) for a complete walkthrough.

## Commands

| Command | Description | Mutates Repo? |
|---------|-------------|---------------|
| `init` | Interactive config wizard | No |
| `validate` | Check config and environment | No |
| `plan` | Dry-run: show execution plan | No |
| `release` | Execute versioning workflow | Yes |
| `rollback` | Revert last operation | Yes |
| `doctor` | Diagnose environment | No |
| `changelog` | Generate changelog from commits | No |

See the [CLI Reference](docs/cli-reference.md) for full details on each command, parameters, and examples.

> **Backward compatibility:** Running `versionings --semver=<type> --branch=<name>` without a subcommand is equivalent to `versionings release`.

## Features

- 6 branching strategies (default, trunk-based, git-flow, release-branch, hotfix, maintenance)
- 6 SCM platforms (GitHub, GitHub Enterprise, Bitbucket, Bitbucket Server, GitLab, Azure DevOps)
- Conventional Commits parsing with `--semver=auto`
- Changelog generation from commit history
- Interactive and non-interactive modes
- Config Provenance (`--print-config`)
- Dry-run with `plan` command
- Automatic rollback on failure
- JSON output for CI (`--json`)

See the [documentation](docs/index.md) for details on each feature.

## Exit Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | SUCCESS | Successful completion |
| 1 | CONFIG_ERROR | Configuration error |
| 2 | DIRTY_TREE | Uncommitted changes |
| 3 | INVALID_ARGS | Invalid CLI arguments |
| 4 | ARTIFACT_CONFLICT | Branch or tag already exists |
| 5 | COMMAND_FAILED | Git/npm command failed |
| 6 | NETWORK_ERROR | Network error |
| 7 | INCOMPLETE_ROLLBACK | Rollback could not complete |
| 8 | NO_OPERATION | Nothing to rollback |
| 9 | USER_CANCELLED | User cancelled operation |
| 10 | POLICY_VIOLATION | Branch policy violated |
| 11 | NO_CONVENTIONAL_COMMITS | No conventional commits for auto-bump |

See the [Failure Matrix](docs/failure-matrix.md) for causes, error examples, and remediation steps.

## Documentation

Full documentation is available in the [docs/](docs/index.md) directory:

- [Setup Guide](docs/setup-guide.md) — Installation, configuration, and first release
- [Configuration Reference](docs/configuration-reference.md) — All config fields, sources, and examples
- [CLI Reference](docs/cli-reference.md) — Commands, flags, and output formats
- [Failure Matrix](docs/failure-matrix.md) — Exit codes with causes and solutions
- [Branch Strategy Cookbook](docs/branch-strategy-cookbook.md) — 6 branching strategies with examples
- [SCM Provider Guide](docs/scm-provider-guide.md) — Platform setup and PR/MR automation
- [CI/CD Examples](docs/ci-examples.md) — GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines
- [Changelog Format Guide](docs/changelog-format-guide.md) — Conventional Commits and changelog configuration
- [Migration Guide](docs/migration-guide.md) — Upgrading between versions

## Development

### Prerequisites

- Node.js >= 18
- npm

### Commands

```bash
npm install          # Install dependencies
npm run build        # Bundle to dist/version.js via esbuild
npm test             # Run all tests (unit, property, integration, e2e)
```

### Test Structure

```text
__tests__/
├── unit/              # Module-level tests with mocks
├── properties/        # Property-based tests (fast-check, 100+ iterations each)
├── integration/       # Full pipeline with real git repos (no mocks)
├── e2e/               # CLI as child process with real git repos
└── helpers/           # Test utilities (repo fixture creation)
```

## License

MIT
