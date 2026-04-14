# 07-electron-desktop-app — Electron Desktop Application

Desktop application built on **Electron** with a main/renderer process architecture and IPC communication,
integrated with **GitHub Enterprise** and a **hotfix** branching strategy for emergency patch releases.

## Stack

- **Runtime:** Node.js ≥ 18
- **Framework:** Electron 32
- **Versioning:** versionings CLI

## Application Overview

The application consists of two Electron processes connected via IPC:

- **Main process** (`src/main.js`) — manages the application lifecycle, creates a
  `BrowserWindow` with `contextIsolation` enabled and a `preload.js` script. Registers IPC handlers:
  - `get-app-version` — returns the application version via `app.getVersion()`
  - `get-system-info` — returns system details: platform, architecture, memory usage

- **Renderer process** (`src/renderer/`) — an HTML page with buttons that invoke IPC calls.
  The `app.js` script calls `window.electronAPI` (exposed through `contextBridge`)
  and renders the returned data into the DOM.

- **Preload script** (`src/preload.js`) — bridge between main and renderer. Uses
  `contextBridge.exposeInMainWorld` to securely expose the IPC methods
  `getVersion()` and `getSystemInfo()` to the renderer process.

## Branching Strategy and SCM Platform

| Parameter | Value |
|-----------|-------|
| SCM platform | GitHub Enterprise |
| Branching strategy | `hotfix` |
| Config format | `version.json` |

**Hotfix strategy** — designed exclusively for emergency patch releases. Only `patch` bumps are
permitted. A hotfix branch is created from `main` and named `hotfix/{version}`. This is ideal for
desktop applications where critical production bugs require an immediate fix without waiting for
a full release cycle.

**GitHub Enterprise** — a self-hosted GitHub instance with its own API endpoint.
Versionings supports GHE via the `apiUrl` parameter, which points to the REST API v3
of your instance instead of `api.github.com`.

## Hotfix Strategy

### How It Works

The hotfix strategy is restricted to emergency patch releases:

- **Patch only** — only `--semver=patch` is allowed. Minor and major releases are rejected.
- **From main** — a hotfix is always created from the `main` branch.
- **hotfix/{version} branch** — versionings creates a branch named `hotfix/{version}`,
  e.g., `hotfix/1.0.1` for a patch release from `1.0.0`.
- **Fast cycle** — minimal steps: bump → branch → tag → push → PR.

### When to Use

- Critical production bug requiring an immediate fix
- Security vulnerability discovered in the current release
- Post-release regression blocking end users

### Constraints

```bash
# Allowed — patch hotfix
npx versionings release --semver=patch --branch=hotfix --push

# Error — minor is not permitted under the hotfix strategy
npx versionings release --semver=minor --branch=hotfix --push
# → Exit code 10: POLICY_VIOLATION
```

## Emergency Release Process

Step-by-step procedure for an emergency hotfix:

### 1. Identify the Issue

A critical bug is discovered in production version `1.0.0`.

### 2. Prepare the Fix

```bash
# Ensure you are on an up-to-date main branch
git checkout main
git pull origin main

# Apply the fix
# ... edit source files ...
git add .
git commit -m "fix: critical auth bypass in session handler"
```

### 3. Validate

```bash
npm run validate
# npx versionings validate
```

Checks the configuration, git remote, and GitHub Enterprise API availability.

### 4. Plan

```bash
npm run plan
# npx versionings plan --semver=patch --branch=hotfix
```

Dry-run: displays the hotfix release plan without making any changes.
Expected result: version `1.0.0` → `1.0.1`, branch `hotfix/1.0.1`.

### 5. Release

```bash
npm run release
# npx versionings release --semver=patch --branch=hotfix --push
```

Executes the full cycle: version bump, `hotfix/1.0.1` branch creation,
tag creation, push to remote, and Pull Request creation on GitHub Enterprise.

### 6. Review and Merge

The Pull Request goes through an expedited review and is merged into `main`.

## Merge-Back Procedure After Hotfix

Once the hotfix is merged into `main`, propagate the changes to all active
development branches:

### Merge into develop (if using git-flow)

```bash
git checkout develop
git pull origin develop
git merge main
# Resolve conflicts if any
git push origin develop
```

### Merge into active feature branches

```bash
git checkout feature/my-feature
git merge main
# Resolve conflicts if any
git push origin feature/my-feature
```

### Delete the hotfix branch

After a successful merge the hotfix branch is no longer needed:

```bash
git branch -d hotfix/1.0.1
git push origin --delete hotfix/1.0.1
```

### Merge-back checklist

1. ✅ Hotfix merged into `main`
2. ✅ `main` merged into `develop` (if applicable)
3. ✅ Active feature branches updated from `main`
4. ✅ Hotfix branch deleted (local + remote)
5. ✅ CI passed on all updated branches

## SCM Platform: GitHub Enterprise

### Differences from GitHub.com

GitHub Enterprise (GHE) is a self-hosted GitHub instance deployed within your
organization's infrastructure. The key difference for versionings is a custom
API endpoint instead of `api.github.com`.

### Configuring apiUrl

In `version.json`, the `apiUrl` field points to the REST API v3 of your GHE instance:

```json
{
  "git": {
    "apiUrl": "https://github.example.com/api/v3"
  }
}
```

URL format: `https://<your-domain>/api/v3`. Versionings uses this endpoint
for all API calls: remote verification, PR creation, and API-based push.

### Token Setup

1. In GitHub Enterprise, navigate to **Settings → Developer settings → Personal access tokens**.
2. Create a token (classic) with the following scope:
   - `repo` — full repository access
3. Add the token as a repository secret:
   - **Name:** `GITHUB_TOKEN`
   - **Value:** your Personal Access Token

The token is passed via `secrets.GITHUB_TOKEN` in the GitHub Actions workflow.

## Configuration

File: `version.json`

```json
{
  "git": {
    "platform": "github-enterprise",
    "url": "https://github.example.com/your-org/07-electron-desktop-app.git",
    "apiUrl": "https://github.example.com/api/v3",
    "branching": {
      "strategy": "hotfix",
      "mainBranch": "main"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `git.platform` | `github-enterprise` — self-hosted GitHub instance |
| `git.url` | Repository URL on your GHE instance |
| `git.apiUrl` | GHE REST API v3 endpoint: `https://<domain>/api/v3` |
| `git.branching.strategy` | `hotfix` — patch-only releases for emergency fixes |
| `git.branching.mainBranch` | `main` — the base branch from which hotfixes are created |

Replace `github.example.com` and `your-org` with the actual values for your GHE instance.

## Prerequisites

- Node.js ≥ 18 and npm
- Git with a remote configured for GitHub Enterprise
- Versionings installed: `npm install --global versionings`
- GitHub Enterprise Personal Access Token with `repo` scope

## Release Workflow

### 1. Validate

```bash
npm run validate
# npx versionings validate
```

Checks the configuration, git remote, and GitHub Enterprise API availability via `apiUrl`.

### 2. Plan

```bash
npm run plan
# npx versionings plan --semver=patch --branch=hotfix
```

Dry-run: displays the hotfix release plan without making any changes.

### 3. Release

```bash
npm run release
# npx versionings release --semver=patch --branch=hotfix --push
```

Executes the full cycle: version bump, hotfix branch and tag creation, push, and PR creation.

## CI Pipeline

The file `.github/workflows/hotfix.yml` automates the hotfix release on push to `main`.

### Pipeline Steps

1. **checkout** — clone with full history (`fetch-depth: 0`)
2. **setup-node** — install Node.js 18
3. **npm install** — install dependencies (including versionings)
4. **validate** — verify configuration and GHE API availability
5. **release** — execute the hotfix release with `--ci --json` for non-interactive mode

### Token

`GITHUB_TOKEN` is provided through the GitHub Actions secrets mechanism:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

For GitHub Enterprise, create a Personal Access Token and add it as a
repository secret (Settings → Secrets → Actions).

## Project Structure

```
07-electron-desktop-app/
├── package.json          # npm package, Electron, hotfix scripts
├── version.json          # GitHub Enterprise, hotfix strategy config
├── .gitignore            # node_modules/, dist/, .versionings/
├── README.md             # This file
├── src/
│   ├── main.js           # Main process: BrowserWindow, IPC handlers
│   ├── preload.js        # contextBridge: electronAPI
│   └── renderer/
│       ├── index.html    # Application HTML page
│       ├── app.js        # UI logic: IPC calls, DOM rendering
│       └── styles.css    # Application styles
└── .github/
    └── workflows/
        └── hotfix.yml    # GitHub Actions: validate → hotfix release
```

## Expected Output

Running `release --semver=patch` from version `1.0.0`:

- **Version:** `1.0.0` → `1.0.1`
- **Branch:** `hotfix/1.0.1`
- **Tag:** `1.0.1--hotfix`
- **Exit code:** `0` (success)
