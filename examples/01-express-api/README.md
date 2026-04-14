# 01-express-api — Express REST API

Minimal versionings integration example. Demonstrates the smallest possible configuration and a complete release workflow — from initialization to push with automatic PR creation.

## What This Example Demonstrates

- A two-field `version.json` that is enough to run the full versionings pipeline
- The default branching strategy with GitHub as the SCM platform
- A five-step quickstart workflow: `init` → `validate` → `plan` → `release` → `release --push`
- A GitHub Actions CI pipeline that automates releases on push to `main`

## Tech Stack

| Component      | Version / Tool       |
|----------------|----------------------|
| Runtime        | Node.js ≥ 18        |
| Framework      | Express 4            |
| Versioning     | versionings CLI      |

## Branching Strategy and Platform

| Parameter           | Value          |
|---------------------|----------------|
| SCM platform        | GitHub         |
| Branching strategy  | `default`      |
| Config format       | `version.json` |

The `default` strategy is the simplest strategy versionings offers. On release it creates a branch named `version/<type>/<version>/<comment>` and an annotated tag. It suits projects with a straightforward workflow and no strict branching policies.

GitHub is used as the SCM platform. When `--push` is passed, versionings pushes the branch and tag to the remote and creates a Pull Request via the GitHub API.

## Configuration

`version.json` contains the minimal required configuration — only two fields:

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/your-org/01-express-api.git"
  }
}
```

| Field          | Description                                                                 |
|----------------|-----------------------------------------------------------------------------|
| `git.platform` | SCM platform (`github`, `gitlab`, `bitbucket`, `azure-devops`, and others) |
| `git.url`      | Git repository URL. Used for remote validation and PR creation             |

All other parameters (strategy, branch naming, PR options) use their defaults. This makes `01-express-api` the ideal starting point for learning versionings.

## Prerequisites

- Node.js ≥ 18 and npm
- Git with a configured remote
- versionings installed globally: `npm install --global versionings`
- Replace `your-org` in `version.json` with your actual repository URL before using `--push`

## Quickstart Workflow

Full release cycle — from initialization to push.

### 1. Initialize the project

If you do not have a `version.json` yet, run the interactive wizard:

```bash
npx versionings init
```

The wizard prompts for platform, repository URL, and branching strategy, then generates `version.json`. In this example the file is already provided with a minimal configuration.

### 2. Validate configuration

Verify that the configuration is valid and the environment is ready:

```bash
npm run validate
# or directly:
npx versionings validate
```

Versionings checks:
- Presence and validity of `version.json`
- Git remote matches the configured URL
- Platform reachability (when a token is available)

### 3. Create a release plan

Preview the release plan without making any changes (dry-run):

```bash
npm run plan
# or directly:
npx versionings plan --semver=patch --branch=release
```

Output includes:
- Current and next version
- Branch and tag names that will be created
- Step-by-step execution plan that `release` will follow

### 4. Release locally

Execute a release without pushing to the remote:

```bash
npx versionings release --semver=patch --branch=release
```

Versionings will:
- Bump the version via `npm version`
- Create branch `version/patch/<version>/release`
- Create an annotated tag

### 5. Release with push

Execute a release, push to the remote, and create a Pull Request:

```bash
npm run release
# or directly:
npx versionings release --semver=patch --branch=release --push
```

A token is required for push and PR creation. Set the environment variable:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

## CI Pipeline

`.github/workflows/release.yml` automates the release on every push to `main`.

### Pipeline steps

1. **Checkout** with `fetch-depth: 0` — full commit history is required for tag and branch analysis.
2. **Node.js 18** — runtime setup.
3. **npm install** — install dependencies (including versionings).
4. **Validate** — verify configuration before releasing.
5. **Release** — run the release with flags:
   - `--semver=patch` — version bump type
   - `--branch=ci-release` — branch name for CI releases
   - `--push` — push to remote and create a PR
   - `--ci` — non-interactive mode (no prompts)
   - `--json` — structured JSON output for CI consumption

### Token

`GITHUB_TOKEN` is provided via GitHub Actions secrets (`${{ secrets.GITHUB_TOKEN }}`). The built-in GitHub Actions token has permissions to push and create PRs within the repository.

```yaml
- name: Release
  run: npx versionings release --semver=patch --branch=ci-release --push --ci --json
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Project Structure

```
01-express-api/
├── package.json          # npm package, validate/plan/release scripts
├── version.json          # Minimal versionings configuration
├── .gitignore            # node_modules/, dist/, .versionings/
├── README.md             # This file
├── src/
│   ├── index.js          # Express app, middleware and route setup
│   ├── routes/
│   │   ├── health.js     # GET /health → { status, version, uptime }
│   │   └── users.js      # GET /users, GET /users/:id
│   └── middleware/
│       └── logger.js     # Request logging (method, url, status, duration)
└── .github/
    └── workflows/
        └── release.yml   # GitHub Actions: validate → release
```

## Expected Output

Running `release --semver=patch` from version `1.0.0` produces:

- **Version:** `1.0.0` → `1.0.1`
- **Branch:** `version/patch/1.0.1/release`
- **Tag:** `1.0.1--release`
- **Exit code:** `0` (success)

With `--push`, additionally:
- Branch and tag are pushed to the remote
- A Pull Request is created on GitHub
