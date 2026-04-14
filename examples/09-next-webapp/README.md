# 09-next-webapp — Next.js Web Application

A Next.js application with server-side rendering, API routes, and a component-based
architecture, integrated with **Bitbucket Server** using the **release-branch** strategy
for release management. Demonstrates extended PR parameters (`milestone`, `linkedIssues`)
and automatic changelog generation.

## Stack

- **Runtime:** Node.js ≥ 18
- **Framework:** Next.js 14
- **UI:** React 18
- **Versioning:** versionings CLI

## Application Overview

### Pages

- **`src/pages/index.js`** — Blog home page. Uses `getServerSideProps` to fetch
  the post list from the internal `/api/posts` endpoint on every request.
  Renders a collection of `PostCard` components.

- **`src/pages/about.js`** — Static "About" page describing the technology stack
  and displaying the current application version from `package.json`.

### API Routes

- **`src/pages/api/posts.js`** — Server-side `GET /api/posts` endpoint. Returns an
  in-memory array of posts, each containing `id`, `title`, `excerpt`, `date`, and
  `author` fields. Only the GET method is supported; all others return 405.

### Components

- **`src/components/Layout.jsx`** — Application layout component. Contains a `<header>`
  with navigation links (Home, About), a `<main>` content area, and a `<footer>`
  with copyright and application version.

- **`src/components/PostCard.jsx`** — Post card component. Displays the title, excerpt,
  formatted date, and author name.

## Branching Strategy and Platform

| Parameter | Value |
|-----------|-------|
| SCM platform | Bitbucket Server |
| Branching strategy | `release-branch` |
| Config format | `version.json` |

### Release-Branch Strategy

The **release-branch** strategy creates a dedicated branch for each release, allowing
development to continue on `main` while the release branch stabilizes.

Key characteristics:

- **Release branches** are named `release/{version}`, e.g. `release/1.1.0`
- **Patch reuse** — the release branch is reused for subsequent patch releases
  within the same minor version
- **Parallel development** — `main` is not blocked during release stabilization
- **Merge-back** — changes are merged back into `main` after the release

### When to Use

- The project requires a stabilization phase before release
- Hotfix patches need to be issued against the current release
- The team is working on the next version in parallel with the current release

## SCM Platform: Bitbucket Server

### Difference from Bitbucket Cloud

Bitbucket Server is a self-hosted Bitbucket instance deployed within the
organization's infrastructure. The key difference for versionings is a custom
REST API endpoint instead of `api.bitbucket.org`.

### Configuring apiUrl

In `version.json`, the `apiUrl` parameter points to the REST API 1.0 of your
Bitbucket Server instance:

```json
{
  "git": {
    "apiUrl": "https://bitbucket.example.com/rest/api/1.0"
  }
}
```

URL format: `https://<your-domain>/rest/api/1.0`. Versionings uses this endpoint
for all API calls: remote verification, pull request creation, and API-based push.

### Token Setup

1. In Bitbucket Server, navigate to **Manage Account → Personal Access Tokens**
2. Create a token with the following permissions:
   - **Repository Read** — read access to the repository
   - **Repository Write** — push access to the repository
3. In Bitbucket Pipelines settings, add a repository variable:
   - **Name:** `BITBUCKET_TOKEN`
   - **Value:** your Personal Access Token
   - **Secured:** enabled

## PR Parameters: milestone and linkedIssues

### Configuration

```json
{
  "git": {
    "pr": {
      "target": "main",
      "milestone": "v2.0",
      "linkedIssues": ["PROJ-101", "PROJ-102"]
    }
  }
}
```

- **`milestone`** — associates the pull request with the `v2.0` milestone
- **`linkedIssues`** — links the pull request to issues `PROJ-101` and `PROJ-102`

### PR Parameter Support Matrix for Bitbucket Server

| Parameter | Bitbucket Server | GitHub | GitLab |
|-----------|:----------------:|:------:|:------:|
| `reviewers` | ✓ | ✓ | ✓ |
| `labels` | ✗ | ✓ | ✓ |
| `draft` | ✗ | ✓ | ✗ |
| `template` | ✗ | ✓ | ✓ |
| `milestone` | ✗ | ✓ | ✓ |
| `linkedIssues` | ✗ | ✓ | ✗ |

> **Note:** The `milestone` and `linkedIssues` parameters are **not supported** by
> the Bitbucket Server REST API and will be silently ignored during pull request
> creation. Versionings does not raise an error — the parameters are simply skipped.
> If you need to associate PRs with milestones or issues, consider migrating to
> GitHub or GitLab.

## Automatic Changelog

The project is configured to automatically update `CHANGELOG.md` on every release.

```json
{
  "changelog": {
    "file": "CHANGELOG.md"
  }
}
```

When `release` is executed, versionings appends an entry to `CHANGELOG.md` containing
the version number, date, and a list of changes extracted from commit messages.

## version.json Configuration

```json
{
  "git": {
    "platform": "bitbucket-server",
    "url": "https://bitbucket.example.com/scm/proj/09-next-webapp.git",
    "apiUrl": "https://bitbucket.example.com/rest/api/1.0",
    "branching": {
      "strategy": "release-branch"
    },
    "pr": {
      "target": "main",
      "milestone": "v2.0",
      "linkedIssues": ["PROJ-101", "PROJ-102"]
    }
  },
  "changelog": {
    "file": "CHANGELOG.md"
  }
}
```

| Field | Description |
|-------|-------------|
| `git.platform` | `bitbucket-server` — Bitbucket Server as the SCM platform |
| `git.url` | Repository URL on Bitbucket Server (SCM format) |
| `git.apiUrl` | REST API 1.0 endpoint: `https://<domain>/rest/api/1.0` |
| `git.branching.strategy` | `release-branch` — creates a release branch for each release |
| `git.pr.target` | `main` — target branch for the pull request |
| `git.pr.milestone` | `v2.0` — PR milestone (ignored on Bitbucket Server) |
| `git.pr.linkedIssues` | `["PROJ-101", "PROJ-102"]` — linked issues (ignored on Bitbucket Server) |
| `changelog.file` | `CHANGELOG.md` — file for automatic changelog |

Replace `bitbucket.example.com` and `proj` with the actual values for your Bitbucket Server instance.

## Prerequisites

- Node.js ≥ 18 and npm
- Git with a remote configured for Bitbucket Server
- versionings installed: `npm install --global versionings`
- Bitbucket Server Personal Access Token with Repository Read/Write permissions

## Release Workflow

### 1. Validate

```bash
npm run validate
# npx versionings validate
```

Validates the configuration, git remote, and Bitbucket Server API availability via `apiUrl`.

### 2. Plan

```bash
npm run plan
# npx versionings plan --semver=minor --branch=release
```

Dry run: displays the release-branch release plan without making any changes.

### 3. Release

```bash
npm run release
# npx versionings release --semver=minor --branch=release --push
```

Executes the full cycle: version bump, release branch creation, tag, push, and
pull request creation targeting `main` on Bitbucket Server. The `milestone` and
`linkedIssues` parameters will be ignored (not supported by the platform).

## CI Pipeline

The `bitbucket-pipelines.yml` file automates the release-branch workflow on push to `main`.

### Pipeline Steps

1. **npm install** — install dependencies
2. **validate** — verify configuration (`--json` for machine-readable output)
3. **release** — execute the release with `--ci --json` for non-interactive mode

### Caching

The pipeline uses the `node` cache to speed up subsequent builds:

```yaml
caches:
  - node
```

### Token

`BITBUCKET_TOKEN` is configured as a secured repository variable in Bitbucket
Pipelines settings:

**Repository Settings → Pipelines → Repository variables** → add `BITBUCKET_TOKEN`
with your Personal Access Token. Enable the **Secured** flag to mask the value in logs.

## Project Structure

```
09-next-webapp/
├── package.json              # npm package, Next.js, release-branch scripts
├── version.json              # Bitbucket Server, release-branch, milestone, linkedIssues
├── CHANGELOG.md              # Automatic changelog
├── .gitignore                # node_modules/, dist/, .versionings/, .next/
├── README.md                 # This file
├── src/
│   ├── pages/
│   │   ├── index.js          # Home: SSR, post list via getServerSideProps
│   │   ├── about.js          # About: version from package.json
│   │   └── api/
│   │       └── posts.js      # API route: GET /api/posts, in-memory data
│   └── components/
│       ├── Layout.jsx        # Layout: header, main, footer with version
│       └── PostCard.jsx      # Post card: title, excerpt, date, author
└── bitbucket-pipelines.yml   # Bitbucket Pipelines: validate → release
```

## Expected Output

When running `release --semver=minor` from version `1.0.0`:

- **Version:** `1.0.0` → `1.1.0`
- **Branch:** `release/1.1.0`
- **Tag:** `1.1.0--release`
- **PR:** targeting `main` on Bitbucket Server (milestone and linkedIssues ignored)
- **Changelog:** entry `1.1.0` appended to `CHANGELOG.md`
- **Exit code:** `0` (success)
