> **Navigation:** [Documentation Index](./index.md) · [Configuration Reference](./configuration-reference.md) · [CLI Reference](./cli-reference.md)

# Setup Guide

This guide walks you through installing Versionings, creating a configuration file, and running your first release.

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js** >= 18 — verify with `node -v`
- **npm** — verify with `npm -v`
- **Git** — verify with `git --version`
- An initialized Git repository with at least one remote configured (`git remote -v`)

## Installation

Install Versionings globally via npm:

```bash
npm install --global versionings
```

Verify the installation:

```bash
versionings doctor
```

## Configuration

Versionings requires a configuration file that specifies your Git platform and repository URL. You can create one interactively or manually.

### Interactive wizard

Run the init command to launch the interactive wizard:

```bash
versionings init
```

The wizard guides you through four steps:

1. **Git platform** — choose your SCM platform (e.g. `github`, `bitbucket`).
2. **Repository URL** — enter the HTTPS or SSH URL of your repository. If a remote named `origin` is detected, it is offered as the default.
3. **PR target branch** — specify the branch that pull requests should target (default: `main`).
4. **Config format** — choose between `json` (writes `version.json`) and `yaml` (writes `.versioningsrc.yml`).

If a configuration file already exists, the wizard asks for confirmation before overwriting.

To skip the format prompt, pass `--format`:

```bash
versionings init --format=yaml
```

For a full list of init parameters, see the [CLI Reference](./cli-reference.md).

### Manual configuration (JSON)

Create a `version.json` file in your project root with the minimum required fields:

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/your-org/your-repo.git"
  }
}
```

### Manual configuration (YAML)

Alternatively, create a `.versioningsrc.yml` file:

```yaml
git:
  platform: github
  url: https://github.com/your-org/your-repo.git
```

Both formats support the same fields. See the [Configuration Reference](./configuration-reference.md) for the complete list of options, default values, and environment variable overrides.

## First Release

### Preview the plan

Before making any changes, preview what Versionings will do:

```bash
versionings plan --semver=patch --branch=initial-setup
```

The `plan` command performs a dry run — it shows the version bump, branch name, tag name, and all steps that would be executed, without modifying your repository.

### Execute the release

When you are satisfied with the plan, run the release:

```bash
versionings release --semver=patch --branch=initial-setup
```

This bumps the version, creates a branch and tag, and commits the changes. Add `--push` to push to the remote and optionally open a pull request.

For the full list of release parameters and flags, see the [CLI Reference](./cli-reference.md).

## Verification

Run the doctor command to verify that your environment and configuration are healthy:

```bash
versionings doctor
```

A successful run confirms that Git is available, the repository has a valid remote, and the configuration file passes schema validation. If any issues are found, the doctor reports them with suggested fixes.

For details on exit codes and error handling, see the [Failure Matrix](./failure-matrix.md).
