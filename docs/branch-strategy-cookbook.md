> **Navigation:** [Documentation Index](./index.md) · [Configuration Reference](./configuration-reference.md)

# Branch Strategy Cookbook

Versionings supports six branching strategies out of the box. Each strategy defines how version branches, tags, and commit messages are composed during a release. This guide covers every strategy with configuration examples, CLI usage, and branching diagrams.

> **Note:** Strategy names used in configuration must exactly match the registry keys: `default`, `trunk-based`, `git-flow`, `release-branch`, `hotfix`, `maintenance`.

## Strategy Comparison

| Strategy | Creates Branch | Allowed Semver Types | Source Branch | Branch Format | Tag Format |
|----------|---------------|---------------------|---------------|---------------|------------|
| `default` | Yes | All | Any | `{branchType}/{semver}/{version}/{comment}` | `{version}--{comment}` |
| `trunk-based` | No | All | main / master | — (commits on main) | `v{version}` |
| `git-flow` | Yes | minor, major, preminor, premajor, prerelease → `release/*`; patch, prepatch → `hotfix/*` | develop (release) / main (hotfix) | `release/{version}` or `hotfix/{version}` | `v{version}` |
| `hotfix` | Yes | patch only | main / master | `hotfix/{version}` | `v{version}` |
| `release-branch` | Yes (reuse for patch) | All (patch gets reuse behavior) | Any | `release/{version}` | `v{version}` |
| `maintenance` | Yes (reuse if patch > 0) | patch only | support/* or main / master | `support/{major}.{minor}` | `v{version}` |

## Choosing a Strategy

**Solo developer or small team with a single release line:**
Use `trunk-based`. All changes land on main, tags mark releases. Minimal overhead.

**Small team with feature branches and PR workflow:**
Use `default`. Each release gets its own branch with a descriptive comment. Good for teams that review version bumps via PRs.

**Team following the git-flow model:**
Use `git-flow`. Release branches come from develop, hotfix branches from main. Familiar to teams already using git-flow conventions.

**Product with long-lived release lines (e.g., v2.1.x, v2.2.x):**
Use `release-branch`. Patch releases reuse the existing release branch. Good for products that maintain multiple minor versions simultaneously.

**Emergency production fixes only:**
Use `hotfix`. Restricted to patch releases from main. Use alongside another strategy for regular releases.

**Maintaining older major/minor versions in parallel (LTS):**
Use `maintenance`. Long-lived support branches for older release lines. Only patch releases allowed.

## Default Strategy

The default strategy creates a unique branch for every release, encoding the semver type, version, and a descriptive comment in the branch name. This is the original Versionings behavior.

**Workflow:**
1. Run release from any branch
2. A new branch is created: `version/{semverType}/{version}/{comment}`
3. Version bump, commit, and tag happen on the new branch
4. Push and open PR to merge back

**Validation rules:**
- No source branch restriction — release can be initiated from any branch
- All semver types are allowed

```text
  any-branch
      │
      ├── version/patch/1.2.3/fix-login
      │       └── tag: 1.2.3--fix-login
      │
      ├── version/minor/1.3.0/add-search
      │       └── tag: 1.3.0--add-search
      │
      └── version/major/2.0.0/breaking-api
              └── tag: 2.0.0--breaking-api
```

**JSON configuration:**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "default"
    }
  }
}
```

**YAML configuration:**

```yaml
git:
  platform: github
  url: "https://github.com/owner/repo.git"
  branching:
    strategy: default
```

**CLI example:**

```bash
versionings plan --semver=patch --branch=fix-login
versionings release --semver=patch --branch=fix-login
```

**Expected results:**
- Branch: `version/patch/1.2.3/fix-login`
- Tag: `1.2.3--fix-login`

## Trunk-Based Strategy

All changes land directly on the main branch. No version branches are created — only tags mark each release. Ideal for teams practicing continuous delivery with short-lived feature branches.

**Workflow:**
1. Ensure you are on main (or master)
2. Run release — version bump and commit happen on main
3. A tag is created: `v{version}`
4. Push the tag

**Validation rules:**
- Current branch must be main or master (or the configured `mainBranch`)
- All semver types are allowed

```text
  main ─────●─────●─────●─────●─────
             │     │     │     │
            v1.0.0 v1.0.1 v1.1.0 v2.0.0
```

**JSON configuration:**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "trunk-based"
    }
  }
}
```

**YAML configuration:**

```yaml
git:
  platform: github
  url: "https://github.com/owner/repo.git"
  branching:
    strategy: trunk-based
```

**CLI example:**

```bash
versionings plan --semver=minor
versionings release --semver=minor
```

**Expected results:**
- Branch: none (commit on main)
- Tag: `v1.1.0`

## Git-Flow Strategy

Implements the git-flow branching model. Release branches are created from develop for minor/major releases. Hotfix branches are created from main for patch releases.

**Workflow (release):**
1. Switch to develop
2. Run release with minor or major — creates `release/{version}` from develop
3. Tag `v{version}` is created
4. Merge release branch back to main and develop

**Workflow (hotfix):**
1. Switch to main
2. Run release with patch — creates `hotfix/{version}` from main
3. Tag `v{version}` is created
4. Merge hotfix branch back to main and develop

**Semver routing:**
- `minor`, `major`, `preminor`, `premajor`, `prerelease` → `release/{version}` from develop
- `patch`, `prepatch` → `hotfix/{version}` from main

**Validation rules:**
- Release types require current branch to be develop (or configured `developBranch`)
- Hotfix types require current branch to be main or master (or configured `mainBranch`)

```text
  main    ─────────────────●──────────●───────
                           │          │
  develop ──●──────●───────┤──────────┤───────
             \            / \        / \
              release/1.1.0  hotfix/1.1.1
              tag: v1.1.0    tag: v1.1.1
```

**JSON configuration:**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "git-flow",
      "mainBranch": "main",
      "developBranch": "develop"
    }
  }
}
```

**YAML configuration:**

```yaml
git:
  platform: github
  url: "https://github.com/owner/repo.git"
  branching:
    strategy: git-flow
    mainBranch: main
    developBranch: develop
```

**CLI example (release):**

```bash
git checkout develop
versionings plan --semver=minor
versionings release --semver=minor
```

**CLI example (hotfix):**

```bash
git checkout main
versionings plan --semver=patch --branch=urgent-fix
versionings release --semver=patch --branch=urgent-fix
```

**Expected results (minor release):**
- Branch: `release/1.1.0`
- Tag: `v1.1.0`

**Expected results (patch hotfix):**
- Branch: `hotfix/1.1.1`
- Tag: `v1.1.1`

## Hotfix Strategy

Dedicated strategy for emergency fixes from the main branch. Only patch releases are allowed. Creates a `hotfix/{version}` branch from main.

**Workflow:**
1. Switch to main
2. Run release with patch — creates `hotfix/{version}`
3. Apply the fix, tag `v{version}`
4. Merge back to main

**Validation rules:**
- Only `patch` semver type is allowed — other types are rejected
- Current branch must be main or master (or configured `mainBranch`)

```text
  main ──────●──────────────●──────
              \            /
               hotfix/1.2.1
               tag: v1.2.1
```

**JSON configuration:**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "hotfix"
    }
  }
}
```

**YAML configuration:**

```yaml
git:
  platform: github
  url: "https://github.com/owner/repo.git"
  branching:
    strategy: hotfix
```

**CLI example:**

```bash
git checkout main
versionings plan --semver=patch --branch=critical-fix
versionings release --semver=patch --branch=critical-fix
```

**Expected results:**
- Branch: `hotfix/1.2.1`
- Tag: `v1.2.1`

## Release Branch Strategy

Long-lived release branches that are reused for patch releases. When a minor or major release is created, a new `release/{version}` branch is made. Subsequent patch releases reuse the existing `release/{major}.{minor}.0` branch.

**Workflow (new release):**
1. Run release with minor — creates `release/1.2.0`
2. Tag `v1.2.0` is created

**Workflow (patch on existing release):**
1. Run release with patch — reuses `release/1.2.0` (switches to existing branch)
2. Tag `v1.2.1` is created on the same branch

**Validation rules:**
- No source branch restriction
- All semver types are allowed
- Patch releases with patch > 0 trigger branch reuse (`reuseBranch: true`)

```text
  main ──────●──────────────────────────
              \
               release/1.2.0
               ├── tag: v1.2.0
               ├── tag: v1.2.1  (patch reuse)
               └── tag: v1.2.2  (patch reuse)
```

**JSON configuration:**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "release-branch"
    }
  }
}
```

**YAML configuration:**

```yaml
git:
  platform: github
  url: "https://github.com/owner/repo.git"
  branching:
    strategy: release-branch
```

**CLI example (new minor release):**

```bash
versionings plan --semver=minor
versionings release --semver=minor
```

**CLI example (patch on existing release branch):**

```bash
versionings plan --semver=patch
versionings release --semver=patch
```

**Expected results (minor):**
- Branch: `release/1.2.0` (new)
- Tag: `v1.2.0`

**Expected results (patch):**
- Branch: `release/1.2.0` (reused)
- Tag: `v1.2.1`

## Maintenance Strategy

Long-term support branches for maintaining older release lines in parallel. Uses `support/{major}.{minor}` branches. Only patch releases are allowed. The branch is reused when the patch component is greater than 0.

**Workflow (first patch on a new support line):**
1. Switch to main (or an existing support branch)
2. Run release with patch — creates `support/{major}.{minor}`
3. Tag `v{version}` is created

**Workflow (subsequent patches):**
1. Switch to the existing `support/{major}.{minor}` branch
2. Run release with patch — reuses the branch
3. Tag `v{version}` is created

**Validation rules:**
- Only `patch` semver type is allowed — other types are rejected
- Current branch must be a `support/*` branch, main, or master

```text
  main ──────●──────●──────────────────
              \      \
               \      support/2.0
               \      ├── tag: v2.0.1
               \      └── tag: v2.0.2  (reuse)
                \
                 support/1.5
                 ├── tag: v1.5.1
                 └── tag: v1.5.2  (reuse)
```

**JSON configuration:**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "maintenance"
    }
  }
}
```

**YAML configuration:**

```yaml
git:
  platform: github
  url: "https://github.com/owner/repo.git"
  branching:
    strategy: maintenance
```

**CLI example:**

```bash
git checkout main
versionings plan --semver=patch
versionings release --semver=patch
```

**Expected results (first patch):**
- Branch: `support/1.5` (new)
- Tag: `v1.5.1`

**Expected results (subsequent patch):**
- Branch: `support/1.5` (reused)
- Tag: `v1.5.2`

## Custom Naming Templates

All strategies support custom branch and tag naming via `git.branching.branchTemplate` and `git.branching.tagTemplate`. Templates use variable substitution with curly braces.

**Available variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `{version}` | Full semver version | `1.2.3` |
| `{major}` | Major version component | `1` |
| `{minor}` | Minor version component | `2` |
| `{patch}` | Patch version component | `3` |
| `{semver}` | Semver type (resolved via config) | `patch` |
| `{comment}` | Branch comment from `--branch` | `fix-login` |
| `{branchType}` | Value of `git.branchType.version` | `version` |

**Example: custom branch and tag templates**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "default",
      "branchTemplate": "v/{major}.{minor}/{comment}",
      "tagTemplate": "release-{version}"
    }
  }
}
```

```yaml
git:
  platform: github
  url: "https://github.com/owner/repo.git"
  branching:
    strategy: default
    branchTemplate: "v/{major}.{minor}/{comment}"
    tagTemplate: "release-{version}"
```

With version `1.2.3` and comment `fix-login`:
- Branch: `v/1.2/fix-login`
- Tag: `release-1.2.3`

**Example: prefix tags with project name**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "trunk-based",
      "tagTemplate": "myapp-v{version}"
    }
  }
}
```

With version `2.0.0`:
- Tag: `myapp-v2.0.0`

**Example: include semver type in branch name**

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "branching": {
      "strategy": "default",
      "branchTemplate": "release/{semver}/{version}"
    }
  }
}
```

With a minor release to version `1.3.0`:
- Branch: `release/minor/1.3.0`

> For the full list of `git.branching` fields and their defaults, see the [Configuration Reference](./configuration-reference.md).
