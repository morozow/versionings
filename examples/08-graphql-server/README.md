# 08-graphql-server — Apollo GraphQL Server

GraphQL server built on **Apollo Server 4** with a typed schema and an in-memory data source,
integrated with **self-hosted GitLab** and the **maintenance** branching strategy for parallel
LTS version support.

## Stack

- **Runtime:** Node.js ≥ 18
- **Framework:** Apollo Server 4 (standalone)
- **Query language:** GraphQL 16
- **Versioning:** versionings CLI

## GraphQL Server and Schema

The server exposes a CRUD API for managing a book collection via GraphQL.

### Types

```graphql
type Book {
  id: ID!
  title: String!
  author: String!
  year: Int
  isbn: String
}
```

### Queries

- `books: [Book!]!` — retrieve all books
- `book(id: ID!): Book` — retrieve a book by ID (returns `null` if not found)

### Mutations

- `addBook(title: String!, author: String!, year: Int, isbn: String): Book!` — add a book
- `removeBook(id: ID!): Boolean!` — remove a book by ID (`true` if removed, `false` if not found)

### Architecture

- **`src/index.js`** — creates an `ApolloServer` instance with `typeDefs` and `resolvers`,
  starts a standalone server on `process.env.PORT || 4000`. On startup it initializes
  `BooksDataSource` and injects it into the request context.

- **`src/schema/typeDefs.js`** — GraphQL schema definition: `Book` type, `books` and `book`
  queries, `addBook` and `removeBook` mutations.

- **`src/schema/resolvers.js`** — resolvers for Query and Mutation. Each resolver delegates
  execution to `BooksDataSource` via `context.dataSources`.

- **`src/datasources/books.js`** — `BooksDataSource` class with an in-memory array of books.
  Methods: `getAll()`, `getById(id)`, `add(data)`, `remove(id)`. Seed data contains three
  classic novels.

## Branching Strategy and Platform

| Parameter | Value |
|-----------|-------|
| SCM platform | GitLab (self-hosted) |
| Branching strategy | `maintenance` |
| Config format | `.versioningsrc.yml` |

### Maintenance Strategy

The **maintenance** strategy targets projects that support multiple LTS versions in parallel.
Each major.minor version gets its own support branch where only patch releases are published.

Key characteristics:

- **Support branches** — named `support/{major}.{minor}` (e.g., `support/2.0`, `support/2.1`)
- **Patch-only** — only patch releases are permitted on support branches
- **Branch reuse** — a support branch is reused for subsequent patch releases of the same
  major.minor version
- **Parallel LTS support** — multiple support branches can coexist, each receiving independent
  patch updates

### When to Use

- The project has consumers on different major or minor versions
- Security patches must be shipped for older versions
- Multiple LTS lines need to be maintained simultaneously

## SCM Platform: GitLab (Self-Hosted)

### Difference from GitLab.com

A self-hosted GitLab instance is deployed within the organization's infrastructure.
The key difference for versionings is a custom API endpoint instead of `gitlab.com/api/v4`.

### Configuring apiUrl

In `.versioningsrc.yml`, the `apiUrl` field points to the REST API v4 of your GitLab instance:

```yaml
git:
  apiUrl: https://gitlab.example.com/api/v4
```

URL format: `https://<your-domain>/api/v4`. Versionings uses this endpoint for all API calls:
remote verification, Merge Request creation, and API-based push.

### Token Setup

1. In GitLab, navigate to **User Settings → Access Tokens**.
2. Create a Personal Access Token with the following scopes:
   - `api` — full API access
   - `write_repository` — push access
3. In the project's CI/CD settings, add a variable:
   - **Key:** `GITLAB_TOKEN`
   - **Value:** your Personal Access Token
   - **Protected:** enabled (available only on protected branches)

## Maintenance Workflow

### Creating a Support Branch

When the current version is `2.1.0` and you need to start maintaining the `2.1.x` line:

```bash
# Create a support branch from the current state of main
git checkout main
git pull origin main
git checkout -b support/2.1
git push origin support/2.1
```

### Patch Release on a Support Branch

```bash
# Switch to the support branch
git checkout support/2.1
git pull origin support/2.1

# Apply the fix
# ... edit code ...
git add .
git commit -m "fix: resolve query timeout for large datasets"

# Validate
npm run validate

# Plan
npm run plan
# → 2.1.0 → 2.1.1, branch support/2.1

# Release
npm run release
# → bump, tag, push, MR into main
```

### Parallel LTS Support

Example: maintaining `support/2.0` and `support/2.1` simultaneously.

```
main (3.0.0-dev)
│
├── support/2.1 (2.1.0 → 2.1.1 → 2.1.2)
│   └── patch releases for consumers on 2.1.x
│
└── support/2.0 (2.0.0 → 2.0.1 → 2.0.2 → 2.0.3)
    └── patch releases for consumers on 2.0.x
```

Each support branch lives independently. Patch releases on `support/2.0` do not affect
`support/2.1` and vice versa. Versionings reuses the existing support branch for subsequent
patch releases (branch reuse).

### Support Branch Lifecycle

1. **Creation** — when a new minor version ships, create `support/{major}.{minor}`
2. **Active maintenance** — publish patch releases as needed
3. **End of Life** — when support for the version ends, archive the branch

```bash
# Archive a support branch (EOL)
git push origin --delete support/2.0
```

## Configuration

File: `.versioningsrc.yml`

```yaml
git:
  platform: gitlab
  url: https://gitlab.example.com/your-org/08-graphql-server.git
  apiUrl: https://gitlab.example.com/api/v4
  branching:
    strategy: maintenance
    mainBranch: main
  pr:
    target: main
```

| Field | Description |
|-------|-------------|
| `git.platform` | `gitlab` — GitLab as the SCM platform |
| `git.url` | Repository URL on the self-hosted GitLab instance |
| `git.apiUrl` | REST API v4 endpoint: `https://<domain>/api/v4` |
| `git.branching.strategy` | `maintenance` — parallel LTS version support |
| `git.branching.mainBranch` | `main` — primary development branch |
| `git.pr.target` | `main` — target branch for Merge Requests |

Replace `gitlab.example.com` and `your-org` with the actual values for your GitLab instance.

The project version `2.1.0` indicates it is on the `support/2.1` maintenance branch and ready
for patch releases.

## Prerequisites

- Node.js ≥ 18 and npm
- Git with a remote configured for self-hosted GitLab
- versionings installed: `npm install --global versionings`
- GitLab Personal Access Token with `api` and `write_repository` scopes

## Release Workflow

### 1. Validate

```bash
npm run validate
# npx versionings validate
```

Checks configuration, git remote, and GitLab API availability at the configured `apiUrl`.

### 2. Plan

```bash
npm run plan
# npx versionings plan --semver=patch --branch=maintenance
```

Dry-run: displays the maintenance release plan without making any changes.

### 3. Release

```bash
npm run release
# npx versionings release --semver=patch --branch=maintenance --push
```

Executes the full cycle: version bump, tag creation, push to the support branch,
and Merge Request creation into `main` on GitLab.

## CI Pipeline

The `.gitlab-ci.yml` file automates maintenance releases on pushes to `main` and
support branches (`support/*`).

### Pipeline Stages

1. **validate** — install dependencies, verify configuration (`--json` for machine-readable output)
2. **release** — execute the maintenance release with `--ci --json` for non-interactive mode

### Triggers

The pipeline runs on pushes to:
- `main` — primary branch
- `support/*` — all support branches (e.g., `support/2.0`, `support/2.1`)

```yaml
only:
  - main
  - /^support\/.*$/
```

### Token

`GITLAB_TOKEN` is passed via GitLab CI/CD Variables:

```yaml
variables:
  GITLAB_TOKEN: $GITLAB_TOKEN
```

In the project settings: **Settings → CI/CD → Variables** → add `GITLAB_TOKEN` with your
Personal Access Token. Enable the **Protected** flag to restrict access to protected branches only.

## Project Structure

```
08-graphql-server/
├── package.json            # npm package, Apollo Server, maintenance scripts
├── .versioningsrc.yml      # GitLab self-hosted, maintenance strategy
├── .gitignore              # node_modules/, dist/, .versionings/
├── README.md               # This file
├── src/
│   ├── index.js            # Apollo Server bootstrap, standalone on port 4000
│   ├── schema/
│   │   ├── typeDefs.js     # GraphQL schema: Book, Query, Mutation
│   │   └── resolvers.js    # Resolvers: delegation to BooksDataSource
│   └── datasources/
│       └── books.js        # BooksDataSource: in-memory CRUD for books
└── .gitlab-ci.yml          # GitLab CI: validate → maintenance release
```

## Expected Output

Running `release --semver=patch` from version `2.1.0` on the `support/2.1` branch:

- **Version:** `2.1.0` → `2.1.1`
- **Branch:** `support/2.1` (reused)
- **Tag:** `2.1.1--maintenance`
- **MR:** into `main` on self-hosted GitLab
- **Exit code:** `0` (success)
