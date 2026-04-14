# 03-nestjs-microservice

NestJS task-management microservice with git-flow branching and GitLab Merge Request automation via [versionings](../../README.md).

## What This Example Demonstrates

- NestJS modular architecture (Module → Controller → Service)
- Git-flow branching strategy with `main` and `develop` branches
- GitLab as the SCM platform for automated Merge Requests
- Release workflow from `develop` (minor/major) and hotfix workflow from `main` (patch)
- CI pipeline with `validate` and `release` stages

## NestJS Architecture

The project follows the standard NestJS modular pattern:

```
Module → Controller → Service
```

- **AppModule** — root module that imports feature modules
- **TasksModule** — feature module encapsulating task management logic
- **TasksController** — REST controller handling `GET`, `POST`, `PATCH`, `DELETE /tasks`
- **TasksService** — business logic service with in-memory storage and CRUD operations

## Branching Strategy: git-flow

This project uses **git-flow** — a branching model suited for services with scheduled releases and parallel development.

- **mainBranch**: `main` — stable branch containing only released versions
- **developBranch**: `develop` — integration branch where feature branches are merged

## SCM Platform: GitLab

The project targets **GitLab**. When `release --push` is executed, versionings automatically creates a Merge Request against the configured target branch.

## Git-flow Workflow

### Release from develop (minor/major)

Standard releases originate from the `develop` branch:

1. Ensure all feature branches are merged into `develop`.
2. Switch to `develop`:
   ```bash
   git checkout develop
   ```
3. Validate the configuration:
   ```bash
   npm run validate
   ```
4. Preview the release plan:
   ```bash
   npm run plan
   ```
5. Execute the release:
   ```bash
   npm run release
   ```

Versionings creates a version branch, an annotated tag, and a Merge Request targeting `main`.

### Hotfix from main (patch)

Emergency fixes originate from the `main` branch:

1. Switch to `main`:
   ```bash
   git checkout main
   ```
2. Run a hotfix release:
   ```bash
   npx versionings release --semver=patch --branch=hotfix --push
   ```
3. After the hotfix is merged into `main`, back-merge into `develop`:
   ```bash
   git checkout develop
   git merge main
   ```

## GitLab MR Automation

When `release --push` runs, versionings creates a Merge Request in GitLab with preconfigured parameters:

- **reviewers**: `lead-dev`, `qa-engineer` — assigned automatically
- **labels**: `release`, `microservice` — applied automatically

This ensures a consistent review process across all releases.

## version.json Configuration

```json
{
  "git": {
    "platform": "gitlab",
    "url": "https://gitlab.com/your-org/03-nestjs-microservice.git",
    "branching": {
      "strategy": "git-flow",
      "mainBranch": "main",
      "developBranch": "develop"
    },
    "pr": {
      "target": "main",
      "reviewers": ["lead-dev", "qa-engineer"],
      "labels": ["release", "microservice"]
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `git.platform` | SCM platform — `gitlab` |
| `git.url` | GitLab repository URL |
| `git.branching.strategy` | Branching strategy — `git-flow` |
| `git.branching.mainBranch` | Production branch — `main` |
| `git.branching.developBranch` | Integration branch — `develop` |
| `git.pr.target` | MR target branch — `main` |
| `git.pr.reviewers` | Reviewers assigned automatically to each MR |
| `git.pr.labels` | Labels applied automatically to each MR |

## CI Pipeline (.gitlab-ci.yml)

The pipeline consists of two stages:

### validate

Runs on every push. Checks that the versionings configuration and environment are valid:

```yaml
validate:
  stage: validate
  script:
    - npm install
    - npx versionings validate --json
```

### release

Runs only on pushes to `develop`. Performs an automated release:

```yaml
release:
  stage: release
  script:
    - npm install
    - npx versionings release --semver=minor --branch=ci-release --push --ci --json
  only:
    - develop
```

The `GITLAB_TOKEN` is provided via GitLab CI/CD Variables (Settings → CI/CD → Variables).

## Project Structure

```
03-nestjs-microservice/
├── package.json              # Dependencies and npm scripts
├── version.json              # Versionings config (GitLab, git-flow)
├── tsconfig.json             # TypeScript configuration for NestJS
├── .gitignore                # Git ignore rules
├── .gitlab-ci.yml            # GitLab CI pipeline
├── README.md                 # Project documentation
└── src/
    ├── main.ts               # Entry point — NestJS bootstrap
    ├── app.module.ts          # Root module
    └── tasks/
        ├── tasks.module.ts    # Tasks feature module
        ├── tasks.controller.ts # REST controller for /tasks
        ├── tasks.service.ts   # Business logic service
        └── task.model.ts      # Task interface and TaskStatus enum
```
