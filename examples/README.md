# Versionings Examples

A collection of 10 standalone projects demonstrating real-world usage practices of the **versionings** CLI tool. Projects are ordered from simple (01 — Express API with minimal configuration) to complex (10 — Enterprise platform with all advanced features).

The collection covers:
- **6** branching strategies
- **6** SCM platforms (+ self-hosted deployment mode)
- **3** configuration formats
- **7** CLI subcommands
- **6** PR/MR parameters
- All advanced features (structured logging, concurrency lock, policy checker, custom templates)

---

## Project Overview

| # | Project | Technology | Strategy | Platform | Config Format | Key Features |
|---|---------|-----------|----------|----------|---------------|--------------|
| 01 | [express-api](./01-express-api/) | Express | default | github | version.json | Minimal configuration, quickstart, init |
| 02 | [react-component-library](./02-react-component-library/) | React | trunk-based | github | version.json | Conventional commits, auto-bump, changelog |
| 03 | [nestjs-microservice](./03-nestjs-microservice/) | NestJS | git-flow | gitlab | version.json | MR reviewers/labels, mainBranch/developBranch |
| 04 | [cli-tool](./04-cli-tool/) | yargs | release-branch | github | version.json | Draft PR, PR template, patch reuse |
| 05 | [monorepo-packages](./05-monorepo-packages/) | Node.js | default | bitbucket | .versioningsrc.yml | Config hierarchy, package.json#versionings, env vars |
| 06 | [fastify-service](./06-fastify-service/) | Fastify | trunk-based | azure-devops | version.json | --ci --json, non-interactive mode |
| 07 | [electron-desktop-app](./07-electron-desktop-app/) | Electron | hotfix | github-enterprise | version.json | apiUrl, hotfix-only patch, emergency release |
| 08 | [graphql-server](./08-graphql-server/) | Apollo | maintenance | gitlab (self-hosted) | .versioningsrc.yml | apiUrl, support branches, LTS |
| 09 | [next-webapp](./09-next-webapp/) | Next.js | release-branch | bitbucket-server | version.json | apiUrl, milestone, linkedIssues, changelog |
| 10 | [enterprise-platform](./10-enterprise-platform/) | Express DDD | git-flow | github | version.json | ALL advanced features |

---

## Coverage Matrix

The table below shows which versionings capabilities each example demonstrates. The **✓** symbol indicates that the feature is actively used and documented in the project README.

### Branching Strategies

| Strategy | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|----------|----|----|----|----|----|----|----|----|----|----|
| default | ✓ | | | | ✓ | | | | | |
| trunk-based | | ✓ | | | | ✓ | | | | |
| git-flow | | | ✓ | | | | | | | ✓ |
| release-branch | | | | ✓ | | | | | ✓ | |
| hotfix | | | | | | | ✓ | | | |
| maintenance | | | | | | | | ✓ | | |

### SCM Platforms

| Platform | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|----------|----|----|----|----|----|----|----|----|----|----|
| github | ✓ | ✓ | | ✓ | | | | | | ✓ |
| github-enterprise | | | | | | | ✓ | | | |
| gitlab | | | ✓ | | | | | | | |
| gitlab (self-hosted) | | | | | | | | ✓ | | |
| bitbucket | | | | | ✓ | | | | | |
| bitbucket-server | | | | | | | | | ✓ | |
| azure-devops | | | | | | ✓ | | | | |

> **Note:** `gitlab (self-hosted)` and `github-enterprise` are deployment variants of the `gitlab` and `github` platforms respectively, with `git.apiUrl` configured to connect to a corporate server.

### Config Formats

| Format | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|--------|----|----|----|----|----|----|----|----|----|----|
| version.json | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ |
| .versioningsrc.yml | | | | | ✓ | | | ✓ | | |
| package.json#versionings | | | | | ✓ | | | | | |

### CLI Commands

| Command | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|---------|----|----|----|----|----|----|----|----|----|----|
| init | ✓ | | | | | | | | | |
| validate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| plan | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| release | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rollback | | | | | | | | | | ✓ |
| doctor | | | | | | | | | | ✓ |
| changelog | | ✓ | | | | | | | ✓ | ✓ |

### PR/MR Parameters

| Parameter | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|-----------|----|----|----|----|----|----|----|----|----|----|
| reviewers | | | ✓ | | | | | | | ✓ |
| labels | | | ✓ | | | | | | | ✓ |
| draft | | | | ✓ | | | | | | ✓ |
| template | | | | ✓ | | | | | | ✓ |
| milestone | | | | | | | | | ✓ | ✓ |
| linkedIssues | | | | | | | | | ✓ | ✓ |

### Advanced Features

| Feature | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|---------|----|----|----|----|----|----|----|----|----|----|
| --semver=auto | | ✓ | | | | | | | | ✓ |
| --ci --json | | | | | | ✓ | | | | ✓ |
| --push | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| --strict | | | | | | | | | | ✓ |
| --print-config | | | | | | | | | | ✓ |
| conventionalCommits | | ✓ | | | | | | | | ✓ |
| changelog.file | | ✓ | | | | | | | ✓ | ✓ |
| logLevel | | | | | | | | | | ✓ |
| lockTimeoutMs | | | | | | | | | | ✓ |
| branchTemplate | | | | | | | | | | ✓ |
| tagTemplate | | | | | | | | | | ✓ |
| apiUrl | | | | | | | ✓ | ✓ | ✓ | |
| env var overrides | | | | | ✓ | | | | | |

---

## Local Setup

Any example can be run locally by following these steps:

### 1. Clone the repository

```bash
git clone https://github.com/your-org/versionings.git
cd versionings/examples
```

### 2. Navigate to the example directory

```bash
cd 01-express-api    # or any other example (02-react-component-library, 03-nestjs-microservice, ...)
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure access tokens

To interact with the SCM platform you need to set up an access token. The method depends on the platform:

| Platform | Environment Variable | Where to Obtain |
|----------|---------------------|-----------------|
| GitHub | `GITHUB_TOKEN` | Settings → Developer settings → Personal access tokens |
| GitHub Enterprise | `GITHUB_TOKEN` | Same as GitHub, on the corporate server |
| GitLab | `GITLAB_TOKEN` | Settings → Access Tokens |
| GitLab (self-hosted) | `GITLAB_TOKEN` | Same as GitLab, on the corporate server |
| Bitbucket | `BITBUCKET_TOKEN` | Personal settings → App passwords |
| Bitbucket Server | `BITBUCKET_TOKEN` | Same as Bitbucket, on the corporate server |
| Azure DevOps | `AZURE_DEVOPS_TOKEN` | User settings → Personal access tokens |

Export the token before running:

```bash
export GITHUB_TOKEN=your-token-here    # for GitHub/GitHub Enterprise
export GITLAB_TOKEN=your-token-here    # for GitLab
export BITBUCKET_TOKEN=your-token-here # for Bitbucket
export AZURE_DEVOPS_TOKEN=your-token   # for Azure DevOps
```

### 5. Run versionings

```bash
# Validate configuration
npm run validate

# Preview the release plan (dry-run)
npm run plan

# Execute the release
npm run release
```

> **Important:** Before running `release`, make sure the working tree is clean (`git status` shows no changes) and the remote repository is configured correctly.

---

## Coverage Verification

The example collection provides complete coverage of versionings capabilities:

| Category | Coverage | Details |
|----------|----------|---------|
| Branching Strategies | 6/6 ✓ | default (01, 05), trunk-based (02, 06), git-flow (03, 10), release-branch (04, 09), hotfix (07), maintenance (08) |
| SCM Platforms | 6+1/6+1 ✓ | github (01, 02, 04, 10), github-enterprise (07), gitlab (03), gitlab self-hosted (08), bitbucket (05), bitbucket-server (09), azure-devops (06) |
| Config Formats | 3/3 ✓ | version.json (01–04, 06, 07, 09, 10), .versioningsrc.yml (05, 08), package.json#versionings (05) |
| CLI Commands | 7/7 ✓ | init (01), validate (all), plan (all), release (all), rollback (10), doctor (10), changelog (02, 09, 10) |
| PR Parameters | 6/6 ✓ | reviewers (03, 10), labels (03, 10), draft (04, 10), template (04, 10), milestone (09, 10), linkedIssues (09, 10) |
| Uniqueness | ✓ | No two projects share the same strategy + platform combination |

---

## Documentation

Detailed documentation for each versionings capability:

- [Setup and Configuration Guide](../docs/setup-guide.md)
- [Configuration Reference](../docs/configuration-reference.md)
- [CLI Command Reference](../docs/cli-reference.md)
- [Branching Strategy Cookbook](../docs/branch-strategy-cookbook.md)
- [SCM Provider Guide](../docs/scm-provider-guide.md)
- [CI Configuration Examples](../docs/ci-examples.md)
