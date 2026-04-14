# 06-fastify-service — Fastify HTTP Service

HTTP service built on **Fastify** with a plugin architecture, integrated with **Azure DevOps**
and a fully non-interactive CI workflow via `--ci --json` flags.

## Stack

- **Runtime:** Node.js ≥ 18
- **Framework:** Fastify 5
- **Versioning:** versionings CLI

## Service Overview

The service exposes two Fastify plugins:

- **health** — `GET /health` returns service status, the version from `package.json`,
  and the current timestamp. Intended for health checks in orchestrators (Kubernetes, Azure App Service).
- **items** — CRUD operations for items backed by an in-memory store (`Map`).
  Routes: `GET /items`, `POST /items`, `PUT /items/:id`, `DELETE /items/:id`.
  Input is validated through Fastify's built-in JSON Schema mechanism.

Fastify starts with `logger: true` — the built-in Pino logger emits structured JSON logs,
which simplifies parsing in CI pipelines and monitoring systems.

## Branching Strategy and Platform

| Parameter | Value |
|-----------|-------|
| SCM platform | Azure DevOps |
| Branching strategy | `trunk-based` |
| Config format | `version.json` |

**Trunk-based strategy** — all changes are committed directly to `main`. On release,
versionings creates a version branch and tag from `main`. This suits services with
continuous delivery where `main` is always in a deployable state.

**Azure DevOps** — Microsoft's CI/CD platform. Versionings supports Azure DevOps for
push operations, Pull Request creation, and remote validation. The token is supplied
via the pipeline variable `AZURE_DEVOPS_TOKEN`.

## Azure DevOps Integration

### Token Setup

1. In Azure DevOps, open **User Settings → Personal Access Tokens**.
2. Create a token with the following scopes:
   - **Code:** Read & Write
   - **Pull Request Threads:** Read & Write
3. In the pipeline settings, add a variable:
   - **Name:** `AZURE_DEVOPS_TOKEN`
   - **Value:** your PAT
   - **Keep this value secret:** ✓

Versionings uses this token to push branches/tags and create Pull Requests
via the Azure DevOps REST API.

### Pipeline Variables vs Secrets

In Azure Pipelines, variables are referenced with the `$(VARIABLE_NAME)` syntax:

```yaml
env:
  AZURE_DEVOPS_TOKEN: $(AZURE_DEVOPS_TOKEN)
```

Secret variables are masked in pipeline output and are not available in fork pipelines.

## Non-Interactive Mode

This example demonstrates a fully non-interactive CI workflow. All npm scripts
include the `--ci` and `--json` flags.

### The `--ci` Flag

The `--ci` flag switches versionings to non-interactive mode:

- All interactive prompts are disabled (confirmations, option selection).
- Operations execute without waiting for user input.
- Equivalent to the combination `--non-interactive --yes`.
- Required in CI/CD pipelines where stdin is unavailable.

```bash
# Without --ci: versionings may prompt for confirmation
npx versionings release --semver=patch --branch=release --push

# With --ci: runs without prompts
npx versionings release --semver=patch --branch=release --push --ci
```

### The `--json` Flag

The `--json` flag switches output to structured JSON format:

- All output is a single JSON object on stdout (success) or stderr (error).
- No ANSI codes, colors, or progress bars.
- Stable contract: JSON fields do not change between versions.
- Safe for parsing in CI scripts.

Successful output example:

```json
{
  "success": true,
  "version": "1.0.1",
  "previousVersion": "1.0.0",
  "branch": "version/patch/1.0.1/release",
  "tag": "1.0.1--release"
}
```

Error output example (stderr):

```json
{
  "success": false,
  "error": "ARTIFACT_CONFLICT",
  "message": "Branch version/patch/1.0.1/release already exists",
  "exitCode": 4
}
```

## Parsing JSON Output in CI Scripts

JSON output is convenient for extracting data in subsequent pipeline steps.

### Azure Pipelines: Capturing the Version

```yaml
- script: |
    OUTPUT=$(npx versionings release --semver=patch --branch=ci-release --push --ci --json)
    VERSION=$(echo "$OUTPUT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).version))")
    echo "##vso[task.setvariable variable=RELEASE_VERSION]$VERSION"
  displayName: 'Release and capture version'
  env:
    AZURE_DEVOPS_TOKEN: $(AZURE_DEVOPS_TOKEN)
```

### Checking Status via JSON

```bash
OUTPUT=$(npx versionings validate --ci --json)
SUCCESS=$(echo "$OUTPUT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).success))")
if [ "$SUCCESS" != "true" ]; then
  echo "Validation failed"
  exit 1
fi
```

### Combining `--ci --json`

Always use both flags together in CI environments:

| Flag | Without `--json` | With `--json` |
|------|------------------|---------------|
| Without `--ci` | Interactive, text | Interactive, JSON |
| With `--ci` | Non-interactive, text | Non-interactive, JSON ✓ |

The `--ci --json` combination is the only mode that guarantees predictable
behavior and parseable output in a CI environment.

## Configuration

File `version.json`:

```json
{
  "git": {
    "platform": "azure-devops",
    "url": "https://dev.azure.com/your-org/project/_git/06-fastify-service",
    "branching": {
      "strategy": "trunk-based",
      "mainBranch": "main"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `git.platform` | `azure-devops` — Microsoft's Git hosting platform |
| `git.url` | Repository URL in Azure DevOps format: `https://dev.azure.com/{org}/{project}/_git/{repo}` |
| `git.branching.strategy` | `trunk-based` — all releases branch from main |
| `git.branching.mainBranch` | `main` — the primary branch |

Replace `your-org` and `project` with your actual Azure DevOps organization values.

## Prerequisites

- Node.js ≥ 18 and npm
- Git with a configured remote
- Versionings installed: `npm install --global versionings`
- Azure DevOps Personal Access Token with Code (Read & Write) scope

## Release Workflow

### 1. Validate

```bash
npm run validate
# npx versionings validate --ci --json
```

Checks configuration, git remote, and Azure DevOps accessibility.
Output is a JSON object with the validation result.

### 2. Plan

```bash
npm run plan
# npx versionings plan --semver=patch --branch=release --ci --json
```

Dry-run: displays the release plan in JSON format without making any changes.

### 3. Release

```bash
npm run release
# npx versionings release --semver=patch --branch=release --push --ci --json
```

Executes the full cycle: version bump, branch and tag creation, push, and PR creation.
Output is a JSON object with details of the created artifacts.

## CI Pipeline

The `azure-pipelines.yml` file automates the release on push to `main`.

### Pipeline Steps

1. **NodeTool@0** — installs Node.js 18.x.
2. **npm install** — installs dependencies (including versionings).
3. **validate --ci --json** — checks configuration in non-interactive mode.
4. **release --ci --json** — executes the release with JSON output.

All steps use `--ci --json` for predictable behavior in CI.

### Token

`AZURE_DEVOPS_TOKEN` is passed via a pipeline variable:

```yaml
env:
  AZURE_DEVOPS_TOKEN: $(AZURE_DEVOPS_TOKEN)
```

The variable must be configured as a secret in Azure Pipelines
(Pipeline → Edit → Variables → New variable → Keep this value secret).

## Project Structure

```
06-fastify-service/
├── package.json          # npm package; scripts use --ci --json
├── version.json          # Azure DevOps, trunk-based config
├── .gitignore            # node_modules/, dist/, .versionings/
├── README.md             # This file
├── src/
│   ├── index.js          # Fastify app entry point, plugin registration
│   ├── plugins/
│   │   ├── health.js     # GET /health → { status, version, timestamp }
│   │   └── items.js      # CRUD /items with JSON Schema validation
│   └── schemas/
│       └── item.schema.js # JSON Schema for Item { name, description, price }
└── azure-pipelines.yml   # Azure Pipelines: validate → release
```

## Expected Output

Running `release --semver=patch` from version `1.0.0`:

- **Version:** `1.0.0` → `1.0.1`
- **Branch:** `version/patch/1.0.1/release`
- **Tag:** `1.0.1--release`
- **Exit code:** `0` (success)

JSON output:

```json
{
  "success": true,
  "version": "1.0.1",
  "previousVersion": "1.0.0",
  "branch": "version/patch/1.0.1/release",
  "tag": "1.0.1--release"
}
```
