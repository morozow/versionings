> **Navigation:** [Documentation Index](./index.md) · [CLI Reference](./cli-reference.md)

# Failure Matrix

Complete reference for all Versionings exit codes, their causes, and remediation steps. Use this document to diagnose errors in local development and CI pipelines.

## Exit Codes Overview

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

## Exit Code 0: SUCCESS

A zero exit code indicates the operation completed without errors. When `--json` is used, the output is a single JSON object on stdout:

```json
{
  "success": true,
  "version": "1.2.3",
  "branch": "version/patch/1.2.3/fix-login",
  "tag": "1.2.3--fix-login"
}
```

In non-JSON mode, a human-readable summary is printed to stdout. No action is required.

## Exit Code 1: CONFIG_ERROR

Configuration file is missing, unreadable, or fails schema validation.

**Typical causes:**

- No configuration file found (`version.json`, `.versioningsrc`, `.versioningsrc.json`, `.versioningsrc.yml`, `.versioningsrc.yaml`, or `versionings` key in `package.json`)
- Configuration file contains invalid JSON or YAML syntax
- A required field is missing (e.g., `git.platform` or `git.url`)
- A field value does not match the expected type or enum (e.g., `git.platform: "unsupported"`)

**Example error message:**

```text
Error [CONFIG_ERROR]: Configuration validation failed
  - git.platform: must be one of github, github-enterprise, bitbucket, bitbucket-server, gitlab, azure-devops
  - git.url: is required
```

**Remediation steps:**

1. Run `versionings validate --json` to see all validation errors.
2. Run `versionings doctor` to check environment and config health.
3. Fix the reported fields in your configuration file.
4. If unsure about the schema, refer to `version.schema.json` or run `versionings init` to generate a valid config.

**Retryable:** No — fix the configuration first.

## Exit Code 2: DIRTY_TREE

The working tree has uncommitted changes. Versionings requires a clean working tree before performing mutations to ensure rollback safety.

**Typical causes:**

- Unstaged or staged changes detected by `git status --porcelain`
- Untracked files that are not in `.gitignore`

**Example error message:**

```text
Error [DIRTY_TREE]: Working tree has uncommitted changes
  M  src/index.ts
  ?? temp.log
```

**Remediation steps:**

1. Commit your changes: `git add . && git commit -m "save work"`.
2. Or stash them: `git stash`.
3. Or discard them: `git checkout -- .` (use with caution).
4. Re-run the versionings command.

**Retryable:** Yes — after committing or stashing changes.

## Exit Code 3: INVALID_ARGS

The CLI was invoked with invalid or missing arguments.

**Typical causes:**

- Unknown subcommand (e.g., `versionings deploy`)
- Missing required flags (e.g., `--semver` or `--branch` for `release`)
- Invalid value for `--semver` (e.g., `--semver=huge`)

**Example error message:**

```text
Error [INVALID_ARGS]: Unknown argument: deploy
  Available commands: init, validate, plan, release, rollback, doctor, changelog
```

**Remediation steps:**

1. Check the command syntax: `versionings <command> --help`.
2. Verify that `--semver` uses a valid value: `patch`, `prepatch`, `minor`, `preminor`, `premajor`, `prerelease`, `major`, or `auto`.
3. Verify that all required flags are provided for the subcommand.

**Retryable:** No — fix the arguments first.

## Exit Code 4: ARTIFACT_CONFLICT

A branch or tag that Versionings needs to create already exists locally or on the remote.

**Typical causes:**

- A version branch with the same name already exists (e.g., `version/patch/1.2.3/fix-login`)
- A tag with the same name already exists (e.g., `1.2.3--fix-login`)
- A previous release attempt was partially completed and not rolled back

**Example error message:**

```text
Error [ARTIFACT_CONFLICT]: Branch already exists: version/patch/1.2.3/fix-login
  Local branch exists. Delete it or use a different branch name.
```

**Remediation steps:**

1. Delete the conflicting branch: `git branch -D version/patch/1.2.3/fix-login`.
2. Delete the conflicting tag: `git tag -d 1.2.3--fix-login`.
3. If the artifact exists on the remote, delete it there too: `git push origin --delete version/patch/1.2.3/fix-login`.
4. Or use a different `--branch` comment to generate a unique name.
5. If a previous release was interrupted, run `versionings rollback` first.

**Retryable:** No — delete the conflicting artifact or use a different name.

## Exit Code 5: COMMAND_FAILED

A git or npm command executed by Versionings returned a non-zero exit code.

**Typical causes:**

- `npm version` failed due to lifecycle script errors
- `git push` was rejected by the remote (e.g., force-push protection)
- `git tag` failed due to GPG signing issues
- File system permissions prevent writing

**Example error message:**

```text
Error [COMMAND_FAILED]: Command failed: git push origin version/patch/1.2.3/fix-login
  remote: error: GH006: Protected branch update failed.
  remote: error: Required status check is expected.
```

**Remediation steps:**

1. Check the full error output (use `--verbose` for detailed command logs).
2. If `git push` was rejected, verify remote permissions and branch protection rules.
3. If `npm version` failed, check `package.json` lifecycle scripts (`preversion`, `version`, `postversion`).
4. Re-run the command after resolving the underlying issue.

**Retryable:** Depends on the cause — transient issues (e.g., temporary remote unavailability) are retryable; permission or configuration issues are not.

## Exit Code 6: NETWORK_ERROR

A network operation failed. This typically occurs during remote git operations or SCM API calls.

**Typical causes:**

- Git remote is unreachable (DNS failure, firewall, VPN disconnected)
- SCM API request timed out (configurable via `git.api.timeout`)
- Authentication token is expired, revoked, or has insufficient permissions

**Example error message:**

```text
Error [NETWORK_ERROR]: Failed to create pull request via GitHub API
  Request timed out after 30000ms
  URL: https://api.github.com/repos/owner/repo/pulls
```

**Remediation steps:**

1. Verify network connectivity: `git ls-remote origin`.
2. Check that your authentication token is valid and has the required scopes.
3. If the API timed out, increase `git.api.timeout` in your configuration.
4. If behind a proxy or firewall, ensure the SCM API endpoint is accessible.
5. Re-run the command.

**Retryable:** Yes — network issues are typically transient.

## Exit Code 7: INCOMPLETE_ROLLBACK

A rollback operation could not complete all reversal steps. The repository may be in a partially rolled-back state requiring manual intervention.

**Typical causes:**

- A branch or tag was already deleted externally during rollback
- Network failure occurred mid-rollback while reverting remote changes
- File system error prevented reverting a local change

**Example error message:**

```text
Error [INCOMPLETE_ROLLBACK]: Rollback partially failed
  ✓ Reverted: npm version (1.2.3 → 1.2.2)
  ✓ Reverted: branch version/patch/1.2.3/fix-login deleted locally
  ✗ Failed: could not delete remote branch version/patch/1.2.3/fix-login
  Manual recovery required. See details above.
```

**Remediation steps:**

1. Review the rollback output to identify which steps succeeded and which failed.
2. Manually complete the failed steps (e.g., `git push origin --delete <branch>`).
3. Verify the repository state: `git status`, `git branch -a`, `git tag -l`.
4. Run `versionings doctor` to confirm the environment is healthy.

**Retryable:** No — manual intervention is required to resolve the partial state.

## Exit Code 8: NO_OPERATION

There is nothing to rollback. This occurs when `versionings rollback` is invoked but no previous operation log exists.

**Typical causes:**

- No previous `release` operation was performed in this repository
- The operation log file was deleted or is not accessible
- A rollback was already completed for the last operation

**Example error message:**

```text
Error [NO_OPERATION]: Nothing to rollback
  No operation log found. Run a release first.
```

**Remediation steps:**

1. Verify that a release was previously executed in this repository.
2. Check that the operation log file exists and is readable.
3. If you need to undo changes manually, use standard git commands.

**Retryable:** No — there is no operation to rollback.

## Exit Code 9: USER_CANCELLED

The user declined a confirmation prompt during an interactive session.

**Typical causes:**

- User answered "no" to the release confirmation prompt
- User pressed Ctrl+C during an interactive prompt
- An interactive prompt timed out waiting for input

**Example error message:**

```text
Error [USER_CANCELLED]: Operation cancelled by user
  The release was not performed. No changes were made.
```

**Remediation steps:**

1. Re-run the command and confirm the prompt.
2. To skip confirmation prompts, use the `--yes` (or `-y`) flag.
3. In CI environments, use `--ci` or `--non-interactive` to disable prompts entirely.

**Retryable:** Yes — re-run the command with `--yes` to auto-confirm.

## Exit Code 10: POLICY_VIOLATION

A branch protection policy defined in the configuration was violated.

**Typical causes:**

- The generated branch name does not match the required naming convention
- The target branch is protected and the current operation is not allowed
- The branching strategy constraints are not satisfied (e.g., hotfix from wrong source branch)

**Example error message:**

```text
Error [POLICY_VIOLATION]: Branch protection policy violated
  Branch "feature/1.2.3" does not match required pattern "version/{semver}/{version}/{comment}"
  Strategy: git-flow
```

**Remediation steps:**

1. Review the branch protection rules in your configuration (`git.branching` section).
2. Ensure the branching strategy is correctly configured for your workflow.
3. Use `versionings plan` to preview the branch name before executing a release.
4. Adjust the `branchTemplate` or `strategy` in your configuration if the policy is too restrictive.

**Retryable:** No — fix the configuration or branch naming.

## Exit Code 11: NO_CONVENTIONAL_COMMITS

The `--semver=auto` flag was used but no conventional commits were found in the commit history, and `conventionalCommits.fallbackBump` is set to `null`.

**Typical causes:**

- No commits follow the Conventional Commits format (`<type>[(<scope>)][!]: <description>`)
- The commit range being analyzed contains only non-conventional commit messages
- `conventionalCommits.fallbackBump` is explicitly set to `null` (no fallback)

**Example error message:**

```text
Error [NO_CONVENTIONAL_COMMITS]: No conventional commits found for auto-bump
  Analyzed 12 commits between v1.2.2 and HEAD.
  None matched the conventional commit format.
  Set conventionalCommits.fallbackBump to "patch", "minor", or "major" to provide a default.
```

**Remediation steps:**

1. Use conventional commit messages in your repository (e.g., `feat: add login`, `fix: resolve crash`).
2. Set `conventionalCommits.fallbackBump` to a default bump level (`"patch"`, `"minor"`, or `"major"`) in your configuration.
3. Or specify the bump level explicitly instead of using `--semver=auto` (e.g., `--semver=patch`).

**Retryable:** No — add conventional commits or configure a fallback bump level.

## CI Integration

Handle exit codes in CI scripts to provide clear feedback and appropriate failure behavior:

```bash
#!/usr/bin/env bash
set -euo pipefail

result=$(versionings release --semver=patch --branch=fix --ci --json 2>&1) || exit_code=$?
exit_code=${exit_code:-0}

case $exit_code in
  0) echo "Release successful" ;;
  1|3) echo "Configuration or argument error — fix and re-run" ; exit 1 ;;
  2) echo "Dirty working tree — commit or stash changes" ; exit 1 ;;
  4) echo "Artifact conflict — branch or tag exists" ; exit 1 ;;
  5|6) echo "Runtime error — check logs and retry" ; exit 1 ;;
  7) echo "Incomplete rollback — manual intervention required" ; exit 1 ;;
  *) echo "Unexpected exit code: $exit_code" ; exit 1 ;;
esac
```

For more CI integration examples, see the [CLI Reference](./cli-reference.md).
