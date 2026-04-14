> **Navigation:** [Documentation Index](./index.md) · [Failure Matrix](./failure-matrix.md) · [Configuration Reference](./configuration-reference.md)

# CLI Reference

Complete reference for all Versionings CLI commands, flags, and output formats.

## Global Flags

These flags are available on every command.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | `false` | Output in JSON format |
| `--verbose` | boolean | `false` | Enable verbose output |
| `--ci` | boolean | `false` | Run in CI mode (non-interactive, no prompts) |
| `--non-interactive` | boolean | `false` | Disable interactive prompts |
| `--yes` / `-y` | boolean | `false` | Auto-confirm all prompts |
| `--strict` | boolean | `false` | Treat unknown config fields as errors |
| `--print-config` | boolean | `false` | Print resolved config with provenance and exit |

## Commands

### init

Generate a configuration file.

```bash
versionings init [--format=<json|yaml>]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--format` | string | No | — | Output format for the config file. Choices: `json`, `yaml` |

#### Examples

Local development — interactive config wizard:

```bash
versionings init
```

Generate a YAML config file:

```bash
versionings init --format=yaml
```

CI — generate JSON config non-interactively:

```bash
versionings init --format=json --non-interactive
```

---

### validate

Validate configuration and environment. This command does not modify the repository.

```bash
versionings validate
```

#### Parameters

No command-specific parameters. Use [global flags](#global-flags) as needed.

#### Examples

Local development — check config and git setup:

```bash
versionings validate
```

CI — JSON output for automated checks:

```bash
versionings validate --json
```

CI — fail on unknown config fields:

```bash
versionings validate --strict
```

---

### plan

Show execution plan without making changes (dry-run). This command does not modify the repository.

```bash
versionings plan --semver=<type> --branch=<name> [options]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--semver` | string | Yes | — | Semantic version type. Choices: `patch`, `prepatch`, `minor`, `preminor`, `premajor`, `prerelease`, `major`, `auto` |
| `--branch` | string | Yes | — | Branch comment / description |
| `--push` | boolean | No | `false` | Include push step in plan |
| `--preid` | string | No | — | Prerelease identifier |
| `--pr-mode` | string | No | `auto` | PR creation mode. Choices: `auto`, `api`, `url` |
| `--no-pr` | boolean | No | `false` | Skip PR/MR creation |

#### Examples

Local development — preview a patch release:

```bash
versionings plan --semver=patch --branch=fix-login
```

CI — JSON plan for automated processing:

```bash
versionings plan --semver=minor --branch=new-feature --json
```

---

### release

Execute the versioning workflow. This command modifies the repository (creates branches, tags, bumps version).

```bash
versionings release --semver=<type> --branch=<name> [options]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--semver` | string | Yes | — | Semantic version type. Choices: `patch`, `prepatch`, `minor`, `preminor`, `premajor`, `prerelease`, `major`, `auto` |
| `--branch` | string | Yes | — | Branch comment / description |
| `--push` | boolean | No | `false` | Push branch and tags to remote |
| `--preid` | string | No | — | Prerelease identifier |
| `--dry-run` | boolean | No | `false` | Show plan without executing (equivalent to `plan`) |
| `--pr-mode` | string | No | `auto` | PR creation mode. Choices: `auto`, `api`, `url` |
| `--no-pr` | boolean | No | `false` | Skip PR/MR creation |

#### Examples

Local development — interactive patch release:

```bash
versionings release --semver=patch --branch=fix-login
```

Push and auto-confirm — minor release without prompts:

```bash
versionings release --semver=minor --branch=feat --push --yes
```

CI — fully non-interactive release:

```bash
versionings release --semver=patch --branch=fix --ci
```

---

### rollback

Rollback the last versioning operation. Reverses completed mutation steps in LIFO order.

```bash
versionings rollback [--from=<path>]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--from` | string | No | — | Path to a specific operation log file |

#### Examples

Local development — rollback the most recent operation:

```bash
versionings rollback
```

Auto-confirm rollback without prompts:

```bash
versionings rollback --yes
```

Rollback a specific operation by log file:

```bash
versionings rollback --from=.versionings/operations/2025-01-15.json
```

---

### doctor

Diagnose environment and configuration. This command does not modify the repository.

```bash
versionings doctor
```

#### Parameters

No command-specific parameters. Use [global flags](#global-flags) as needed.

#### Examples

Local development — run all diagnostics:

```bash
versionings doctor
```

CI — JSON diagnostics for automated processing:

```bash
versionings doctor --json
```

---

### changelog

Generate changelog from commit history. This command does not modify the repository unless `--output` is specified.

```bash
versionings changelog [options]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--from` | string | No | — | Start tag or commit SHA |
| `--to` | string | No | `HEAD` | End tag or commit SHA |
| `--output` | string | No | — | Write changelog to file |
| `--format` | string | No | `markdown` | Output format. Choices: `markdown`, `plain` |

#### Examples

Generate changelog to stdout:

```bash
versionings changelog
```

Write changelog to a file:

```bash
versionings changelog --output=CHANGELOG.md
```

Generate changelog for a specific range:

```bash
versionings changelog --from=v1.0.0 --to=v2.0.0
```

CI — structured JSON output:

```bash
versionings changelog --json
```

## Backward Compatibility

For backward compatibility, invoking `versionings` without a subcommand but with `--semver` and `--branch` flags is equivalent to `versionings release`:

```bash
# Legacy syntax (still supported)
versionings --semver=patch --branch=fix-login

# Equivalent modern syntax
versionings release --semver=patch --branch=fix-login
```

The CLI automatically prepends the `release` subcommand when `--semver` and `--branch` are present without a recognized subcommand.

## Interactive and Non-Interactive Modes

Versionings supports two interaction modes that control how prompts and confirmations are handled.

### Interactive Mode (default)

When running in a terminal (TTY), Versionings operates in interactive mode by default. In this mode:

- Confirmation prompts are displayed before mutation operations (release, rollback)
- The `init` command runs an interactive configuration wizard
- Progress output is displayed with formatting

### Non-Interactive Mode

Non-interactive mode disables all prompts and is activated by any of the following flags:

- `--ci` — designed for CI/CD pipelines; implies non-interactive behavior and suppresses all prompts
- `--non-interactive` — explicitly disables interactive prompts
- `--yes` / `-y` — auto-confirms all prompts (operations proceed without user confirmation)

In non-interactive mode, operations that require confirmation proceed automatically. Combine with `--json` for machine-readable output in CI pipelines:

```bash
versionings release --semver=patch --branch=fix --ci --json
```

## Exit Codes

| Code | Name | Category | Description |
|------|------|----------|-------------|
| 0 | SUCCESS | Success | Successful completion |
| 1 | CONFIG_ERROR | User/Config | Configuration error |
| 2 | DIRTY_TREE | User/Config | Uncommitted changes in working tree |
| 3 | INVALID_ARGS | User/Config | Invalid CLI arguments |
| 4 | ARTIFACT_CONFLICT | User/Config | Branch or tag already exists |
| 5 | COMMAND_FAILED | Runtime | Git/npm command failed |
| 6 | NETWORK_ERROR | Runtime | Network error |
| 7 | INCOMPLETE_ROLLBACK | Runtime | Rollback could not complete all steps |
| 8 | NO_OPERATION | User/Config | Nothing to rollback |
| 9 | USER_CANCELLED | User/Config | User cancelled the operation |
| 10 | POLICY_VIOLATION | User/Config | Branch protection policy violated |
| 11 | NO_CONVENTIONAL_COMMITS | User/Config | No conventional commits found for auto-bump |

For detailed causes and remediation steps, see the [Failure Matrix](./failure-matrix.md).

## JSON Output Format

When `--json` is passed, Versionings outputs a single JSON object. No ANSI codes or progress text are included, making it safe for CI script consumption.

### Success Output

```json
{
  "ok": true,
  "code": 0,
  "message": "Release completed successfully",
  "data": {
    "version": "1.2.3",
    "branch": "version/patch/1.2.3/fix-login",
    "tag": "1.2.3--fix-login",
    "semver": "patch",
    "pushed": false
  }
}
```

### Error Output

```json
{
  "ok": false,
  "code": 2,
  "message": "Working tree has uncommitted changes",
  "errors": [
    {
      "field": "git.status",
      "message": "Uncommitted changes detected: 3 modified files"
    }
  ]
}
```
