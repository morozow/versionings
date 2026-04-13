> **Navigation:** [Documentation Index](./index.md) · [SCM Provider Guide](./scm-provider-guide.md) · [Failure Matrix](./failure-matrix.md) · [Changelog Format Guide](./changelog-format-guide.md)

# CI/CD Examples

Ready-to-use CI/CD configurations for automating Versionings in your pipeline. Each example includes: repository checkout, Node.js setup, global install of `versionings`, a `versionings validate` step to verify configuration before release, and `versionings release` with `--ci` and `--json` flags for non-interactive, machine-readable output. Authentication tokens are passed via platform-specific secrets.

## GitHub Actions

Full workflow for GitHub Actions. The token is provided via `GITHUB_TOKEN` (built-in) or a custom `VERSIONINGS_TOKEN` secret for API-based PR creation.

```yaml
name: Versionings Release

on:
  push:
    branches:
      - main

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install Versionings
        run: npm install -g versionings

      - name: Validate configuration
        run: versionings validate --json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Release
        run: versionings release --semver=patch --branch=ci-release --push --ci --json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

To use a custom token (e.g. for cross-repo PR creation), replace the `env` block:

```yaml
      - name: Release
        run: versionings release --semver=patch --branch=ci-release --push --ci --json
        env:
          VERSIONINGS_TOKEN: ${{ secrets.VERSIONINGS_TOKEN }}
```

## GitLab CI

Full `.gitlab-ci.yml` configuration. The token is provided via the `GITLAB_TOKEN` CI/CD variable configured in project settings.

```yaml
image: node:18

stages:
  - validate
  - release

validate:
  stage: validate
  script:
    - npm install -g versionings
    - versionings validate --json
  variables:
    GITLAB_TOKEN: $GITLAB_TOKEN

release:
  stage: release
  script:
    - npm install -g versionings
    - versionings release --semver=patch --branch=ci-release --push --ci --json
  variables:
    GITLAB_TOKEN: $GITLAB_TOKEN
  only:
    - main
```

## Azure Pipelines

Full `azure-pipelines.yml` configuration. The token is provided via the `AZURE_DEVOPS_TOKEN` pipeline variable configured in the pipeline settings or a variable group.

```yaml
trigger:
  branches:
    include:
      - main

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '18.x'
    displayName: 'Setup Node.js'

  - script: npm install -g versionings
    displayName: 'Install Versionings'

  - script: versionings validate --json
    displayName: 'Validate configuration'
    env:
      AZURE_DEVOPS_TOKEN: $(AZURE_DEVOPS_TOKEN)

  - script: versionings release --semver=patch --branch=ci-release --push --ci --json
    displayName: 'Release'
    env:
      AZURE_DEVOPS_TOKEN: $(AZURE_DEVOPS_TOKEN)
```

## Bitbucket Pipelines

Full `bitbucket-pipelines.yml` configuration. The token is provided via the `BITBUCKET_TOKEN` repository variable configured in repository settings.

```yaml
image: node:18

pipelines:
  branches:
    main:
      - step:
          name: Validate and Release
          script:
            - npm install -g versionings
            - versionings validate --json
            - versionings release --semver=patch --branch=ci-release --push --ci --json
```

The `BITBUCKET_TOKEN` variable must be configured as a secured repository variable in Bitbucket settings. Versionings resolves it automatically from the environment.

## Auto-Bump with Conventional Commits

Use `--semver=auto` to let Versionings determine the bump level from your commit history. This works with any CI platform. The example below uses GitHub Actions:

```yaml
      - name: Auto Release
        run: versionings release --semver=auto --branch=auto-release --push --ci --json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

When using `--semver=auto`, Versionings analyzes commits since the last tag using the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` → minor bump
- `fix:` → patch bump
- `feat!:` or `BREAKING CHANGE` footer → major bump

If no conventional commits are found, the `conventionalCommits.fallbackBump` configuration determines the behavior. Set it to `"patch"`, `"minor"`, or `"major"` for a default bump, or `null` to exit with code 11 (`NO_CONVENTIONAL_COMMITS`). See the [Changelog Format Guide](./changelog-format-guide.md) for full configuration details.

---

## See Also

- [SCM Provider Guide](./scm-provider-guide.md) — platform-specific authentication setup and token scopes
- [Failure Matrix](./failure-matrix.md) — exit code reference for handling CI failures
- [Changelog Format Guide](./changelog-format-guide.md) — Conventional Commits configuration and bump policy
