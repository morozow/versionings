> **Navigation:** [Documentation Index](./index.md) · [Configuration Reference](./configuration-reference.md) · [CLI Reference](./cli-reference.md)

# Operational Hardening Guide

Versionings includes observability and concurrency features designed for enterprise CI/CD environments. This guide covers structured logging, operation IDs, actor metadata, action trace, and the concurrency lock mechanism.

## Structured Logging

Versionings outputs structured JSON log messages to stderr. Logs are separate from the reporter output (stdout), so they can be captured independently by log aggregation systems (ELK, Datadog, CloudWatch).

### Log Format

Each log message is a single JSON object on one line:

```json
{
  "timestamp": "2025-04-14T10:30:00.123Z",
  "level": "info",
  "message": "npm version bump completed",
  "operationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "actor": "alice",
  "ci": false,
  "context": {
    "step": "npm-version-bump",
    "durationMs": 1234
  }
}
```

### Log Levels

| Level | Description | When Shown |
|-------|-------------|------------|
| `debug` | Command execution details, stdout/stderr | `--verbose` or `logLevel: debug` |
| `info` | Key workflow steps (start, bump, branch, tag, push, PR) | `--verbose` or `logLevel: info` |
| `warn` | Non-blocking warnings (stale lock, policy warnings, PR fallback) | Always (default level) |
| `error` | Errors that stop execution (command failed, rollback, lock conflict) | Always |

### Configuring Log Level

Set the log level in your configuration or via environment variable:

```json
{
  "logLevel": "info"
}
```

```bash
VERSIONINGS_LOG_LEVEL=debug versionings release --semver=patch --branch=fix
```

The `--verbose` flag overrides the configured level to `debug`.

## Operation ID

Every CLI invocation generates a unique Operation ID (UUID v4). This ID appears in every log message and in the audit log entry, enabling correlation of all events from a single run.

In JSON output mode (`--json`), the Operation ID is included in the result:

```json
{
  "success": true,
  "operationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "version": "1.2.3",
  "totalDurationMs": 4567
}
```

## Actor Metadata

Versionings captures information about who initiated each operation:

| Field | Source | Fallback |
|-------|--------|----------|
| `gitUserName` | `git config user.name` | `unknown` |
| `gitUserEmail` | `git config user.email` | `unknown` |
| `hostname` | `os.hostname()` | `unknown` |
| `ciActor` | CI environment variables | `null` |

CI actor detection supports:

| CI Platform | Environment Variable |
|-------------|---------------------|
| GitHub Actions | `GITHUB_ACTOR` |
| GitLab CI | `GITLAB_USER_LOGIN` |
| Azure DevOps | `BUILD_REQUESTEDFOR` |
| Bitbucket Pipelines | `BITBUCKET_STEP_TRIGGERER_UUID` |

Actor metadata is stored in the audit log and included in `info`-level log messages.

## Action Trace

The pipeline records timing for each step of the workflow. The trace is stored in the audit log and can be used to identify slow operations.

Traced steps: `validate-input`, `check-git-status`, `check-remote`, `auto-bump`, `compute-version`, `policy-check`, `artifact-check`, `npm-version-bump`, `branch-create`, `tag-create`, `changelog-write`, `commit`, `push`, `pr-create`.

Each entry includes:

```json
{
  "step": "npm-version-bump",
  "startedAt": "2025-04-14T10:30:00.000Z",
  "endedAt": "2025-04-14T10:30:01.234Z",
  "durationMs": 1234,
  "status": "success"
}
```

The total duration is included in JSON output as `totalDurationMs`.

## Audit Log

The operation log (`.versionings/operations/`) stores extended audit entries (schemaVersion 2) with:

- Operation ID
- Actor metadata
- Full action trace with timings
- Environment info (Node.js version, CLI version, OS, CI flag)
- Full CLI command (with tokens masked as `***`)

Entries with schemaVersion 1 (from earlier versions) are read without errors — missing fields are filled with defaults.

## Concurrency Lock

Versionings prevents parallel releases on the same repository using a lock file at `.versionings/lock`.

### How It Works

1. Before mutation steps, the pipeline creates a lock file with PID, operation ID, timestamp, and hostname
2. If a lock already exists, Versionings checks whether it is stale
3. After the operation completes (success or failure), the lock is released
4. Signal handlers (SIGINT, SIGTERM) ensure cleanup on forced termination

### Stale Lock Detection

A lock is considered stale when:

- The process with the recorded PID no longer exists (local development)
- The lock age exceeds `lockTimeoutMs` (default: 5 minutes)

In CI environments, PID-based detection is disabled (PIDs are unreliable in containers). Only timeout-based detection is used.

### Configuration

```json
{
  "lockTimeoutMs": 300000
}
```

```bash
VERSIONINGS_LOCK_TIMEOUT_MS=600000 versionings release --semver=patch --branch=fix
```

### Lock Scope

| Command | Creates Lock |
|---------|-------------|
| `release` | Yes (unless `--dry-run`) |
| `rollback` | Yes |
| `plan` | No |
| `validate` | No |
| `doctor` | No |
| `init` | No |
| `changelog` | No |

### Troubleshooting

If you encounter a lock error:

```text
Error [COMMAND_FAILED]: Another versionings process is running
  PID: 12345, Operation: a1b2c3d4, Started: 2025-04-14T10:30:00Z
```

1. Check if the process is still running: `ps -p 12345`
2. If the process is gone, the lock will be auto-cleaned on the next run
3. To force removal: `rm .versionings/lock`
4. In CI, check for parallel jobs targeting the same repository

## Related Documentation

- [Configuration Reference](./configuration-reference.md) — `logLevel` and `lockTimeoutMs` fields
- [CLI Reference](./cli-reference.md) — `--verbose` flag and JSON output format
- [Failure Matrix](./failure-matrix.md) — exit code 5 for lock conflicts
