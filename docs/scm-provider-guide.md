> **Navigation:** [Documentation Index](./index.md) · [CI/CD Examples](./ci-examples.md) · [Configuration Reference](./configuration-reference.md)

# SCM Provider Guide

Versionings supports six SCM platforms for repository hosting and PR/MR automation. Each platform requires a `git.platform` value in your configuration and an authentication token for API-based PR creation.

This guide covers setup for every supported platform, authentication configuration, PR/MR creation modes, and per-platform parameter support.

## GitHub Cloud

**Platform value:** `github`

GitHub Cloud is the default cloud-hosted GitHub service at `github.com`.

### Required Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `git.platform` | Yes | Set to `github` |
| `git.url` | Yes | Repository URL |

### Authentication Token

Create a Personal Access Token (PAT) with the `repo` scope:

1. Go to **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Select the `repo` scope (full control of private repositories)
4. Copy the generated token

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | Platform-specific token |
| `VERSIONINGS_TOKEN` | Cross-platform token (overrides `GITHUB_TOKEN`) |

### Configuration Example

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "pr": {
      "target": "main"
    }
  }
}
```

### URL Formats

| Protocol | Format |
|----------|--------|
| HTTPS | `https://github.com/owner/repo.git` |
| SSH | `git@github.com:owner/repo.git` |

---

## GitHub Enterprise

**Platform value:** `github-enterprise`

GitHub Enterprise is a self-hosted GitHub instance. Requires `git.apiUrl` pointing to your Enterprise API endpoint.

### Required Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `git.platform` | Yes | Set to `github-enterprise` |
| `git.url` | Yes | Repository URL on your Enterprise instance |
| `git.apiUrl` | Yes | API endpoint (e.g., `https://github.example.com/api/v3`) |

### Authentication Token

Create a Personal Access Token on your Enterprise instance:

1. Navigate to your Enterprise instance's **Settings → Developer settings → Personal access tokens**
2. Generate a token with the `repo` scope
3. Copy the generated token

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | Platform-specific token (shared with GitHub Cloud) |
| `VERSIONINGS_TOKEN` | Cross-platform token (overrides `GITHUB_TOKEN`) |

### Configuration Example

```json
{
  "git": {
    "platform": "github-enterprise",
    "url": "https://github.example.com/org/repo.git",
    "apiUrl": "https://github.example.com/api/v3",
    "pr": {
      "target": "main"
    }
  }
}
```

### URL Formats

| Protocol | Format |
|----------|--------|
| HTTPS | `https://github.example.com/org/repo.git` |
| SSH | `git@github.example.com:org/repo.git` |

---

## Bitbucket Cloud

**Platform value:** `bitbucket`

Bitbucket Cloud is Atlassian's cloud-hosted Git service at `bitbucket.org`.

### Required Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `git.platform` | Yes | Set to `bitbucket` |
| `git.url` | Yes | Repository URL |

### Authentication Token

Create an App Password with repository write permissions:

1. Go to **Personal settings → App passwords**
2. Click **Create app password**
3. Select permissions: **Repositories: Write** and **Pull requests: Write**
4. Copy the generated app password

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BITBUCKET_TOKEN` | Platform-specific token |
| `VERSIONINGS_TOKEN` | Cross-platform token (overrides `BITBUCKET_TOKEN`) |

### Configuration Example

```json
{
  "git": {
    "platform": "bitbucket",
    "url": "https://bitbucket.org/workspace/repo.git",
    "pr": {
      "target": "main"
    }
  }
}
```

### URL Formats

| Protocol | Format |
|----------|--------|
| HTTPS | `https://bitbucket.org/workspace/repo.git` |
| SSH | `git@bitbucket.org:workspace/repo.git` |

---

## Bitbucket Server

**Platform value:** `bitbucket-server`

Bitbucket Server (formerly Stash) is Atlassian's self-hosted Git service. Requires `git.apiUrl` pointing to your server's REST API.

### Required Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `git.platform` | Yes | Set to `bitbucket-server` |
| `git.url` | Yes | Repository URL on your server |
| `git.apiUrl` | Yes | REST API endpoint (e.g., `https://bitbucket.example.com/rest/api/1.0`) |

### Authentication Token

Create an HTTP Access Token on your Bitbucket Server instance:

1. Navigate to **Manage account → HTTP access tokens**
2. Click **Create token**
3. Grant **Repository write** and **Pull request write** permissions
4. Copy the generated token

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BITBUCKET_TOKEN` | Platform-specific token (shared with Bitbucket Cloud) |
| `VERSIONINGS_TOKEN` | Cross-platform token (overrides `BITBUCKET_TOKEN`) |

### Configuration Example

```json
{
  "git": {
    "platform": "bitbucket-server",
    "url": "https://bitbucket.example.com/scm/proj/repo.git",
    "apiUrl": "https://bitbucket.example.com/rest/api/1.0",
    "pr": {
      "target": "main"
    }
  }
}
```

### URL Formats

| Protocol | Format |
|----------|--------|
| HTTPS | `https://bitbucket.example.com/scm/proj/repo.git` |
| SSH | `ssh://git@bitbucket.example.com:7999/proj/repo.git` |

---

## GitLab

**Platform value:** `gitlab`

GitLab supports both cloud (`gitlab.com`) and self-hosted instances. For self-hosted GitLab, set `git.apiUrl` to your instance's API endpoint.

### Required Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `git.platform` | Yes | Set to `gitlab` |
| `git.url` | Yes | Repository URL |
| `git.apiUrl` | No (cloud) / Yes (self-hosted) | API endpoint (e.g., `https://gitlab.example.com/api/v4`) |

### Authentication Token

Create a Personal Access Token with the `api` scope:

1. Go to **User Settings → Access Tokens**
2. Click **Add new token**
3. Select the `api` scope (grants complete read/write API access)
4. Copy the generated token

For self-hosted instances, create the token on your GitLab instance using the same steps.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GITLAB_TOKEN` | Platform-specific token |
| `VERSIONINGS_TOKEN` | Cross-platform token (overrides `GITLAB_TOKEN`) |

### Configuration Example

Cloud:

```json
{
  "git": {
    "platform": "gitlab",
    "url": "https://gitlab.com/group/repo.git",
    "pr": {
      "target": "main"
    }
  }
}
```

Self-hosted:

```json
{
  "git": {
    "platform": "gitlab",
    "url": "https://gitlab.example.com/group/repo.git",
    "apiUrl": "https://gitlab.example.com/api/v4",
    "pr": {
      "target": "main"
    }
  }
}
```

### URL Formats

| Protocol | Format |
|----------|--------|
| HTTPS | `https://gitlab.com/group/repo.git` |
| SSH | `git@gitlab.com:group/repo.git` |

---

## Azure DevOps

**Platform value:** `azure-devops`

Azure DevOps is Microsoft's cloud-hosted DevOps platform.

### Required Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `git.platform` | Yes | Set to `azure-devops` |
| `git.url` | Yes | Repository URL |

### Authentication Token

Create a Personal Access Token with Code (Read & Write) scope:

1. Go to **User Settings → Personal access tokens**
2. Click **New Token**
3. Select scope: **Code → Read & Write**
4. Copy the generated token

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AZURE_DEVOPS_TOKEN` | Platform-specific token |
| `VERSIONINGS_TOKEN` | Cross-platform token (overrides `AZURE_DEVOPS_TOKEN`) |

### Configuration Example

```json
{
  "git": {
    "platform": "azure-devops",
    "url": "https://dev.azure.com/org/project/_git/repo",
    "pr": {
      "target": "main"
    }
  }
}
```

### URL Formats

| Protocol | Format |
|----------|--------|
| HTTPS | `https://dev.azure.com/org/project/_git/repo` |

> **Note:** Azure DevOps primarily uses HTTPS URLs. SSH access uses `git@ssh.dev.azure.com:v3/org/project/repo`.

---

## Self-Hosted Platforms

Three platforms support self-hosted deployments. For these, set `git.apiUrl` to point Versionings at your instance's API endpoint.

| Platform | `git.platform` | `git.apiUrl` Example |
|----------|----------------|----------------------|
| GitHub Enterprise | `github-enterprise` | `https://github.example.com/api/v3` |
| Bitbucket Server | `bitbucket-server` | `https://bitbucket.example.com/rest/api/1.0` |
| GitLab (self-hosted) | `gitlab` | `https://gitlab.example.com/api/v4` |

When `git.apiUrl` is set, Versionings directs all API calls (PR creation, branch operations) to that endpoint instead of the cloud default. The `git.url` should also point to your self-hosted instance.

```json
{
  "git": {
    "platform": "github-enterprise",
    "url": "https://github.example.com/org/repo.git",
    "apiUrl": "https://github.example.com/api/v3"
  }
}
```

> **Tip:** Run `versionings doctor` after configuring a self-hosted platform to verify API connectivity.

## Authentication

Versionings resolves the authentication token from multiple sources in the following priority order (highest wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | `git.auth.token` | Token set directly in the configuration file |
| 2 | `VERSIONINGS_TOKEN` | Cross-platform environment variable |
| 3 (lowest) | Platform-specific env var | `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`, `AZURE_DEVOPS_TOKEN` |

Platform-specific environment variable mapping:

| Platform | `git.platform` | Environment Variable |
|----------|----------------|---------------------|
| GitHub Cloud | `github` | `GITHUB_TOKEN` |
| GitHub Enterprise | `github-enterprise` | `GITHUB_TOKEN` |
| Bitbucket Cloud | `bitbucket` | `BITBUCKET_TOKEN` |
| Bitbucket Server | `bitbucket-server` | `BITBUCKET_TOKEN` |
| GitLab | `gitlab` | `GITLAB_TOKEN` |
| Azure DevOps | `azure-devops` | `AZURE_DEVOPS_TOKEN` |

> **Note:** GitHub Enterprise shares `GITHUB_TOKEN` with GitHub Cloud. Bitbucket Server shares `BITBUCKET_TOKEN` with Bitbucket Cloud. If you use both cloud and self-hosted variants, use `git.auth.token` in the config file to avoid conflicts.

### Security Recommendations

- Never commit tokens to version control. Use environment variables or CI secrets.
- In CI environments, pass tokens via platform-specific secrets (see [CI/CD Examples](./ci-examples.md)).
- Use the minimum required scope for each token.
- Rotate tokens regularly according to your organization's security policy.

## PR/MR Modes

Versionings supports three modes for PR/MR creation, controlled by the `--pr-mode` flag or configuration:

### `auto` (default)

Attempts to create a PR/MR via the platform API. If the API call fails (network error, missing token, insufficient permissions), falls back to generating a browser URL with pre-filled PR parameters.

```bash
versionings release --semver=patch --branch=fix-login --push --pr-mode=auto
```

### `api`

Creates a PR/MR exclusively via the platform API. Fails with exit code 1 (`CONFIG_ERROR`) if no authentication token is available or the API call fails. Use this mode in CI pipelines where you need guaranteed API-based PR creation.

```bash
versionings release --semver=minor --branch=add-feature --push --pr-mode=api --ci --json
```

### `url`

Generates a browser URL with pre-filled PR parameters and opens it in the default browser. No API call is made. Useful for local development when you prefer to review the PR in the browser before submitting.

```bash
versionings release --semver=patch --branch=quick-fix --push --pr-mode=url
```

| Mode | API Call | Fallback | Requires Token | Best For |
|------|----------|----------|----------------|----------|
| `auto` | Yes | URL on failure | No (falls back) | General use |
| `api` | Yes | None (fails) | Yes | CI pipelines |
| `url` | No | — | No | Local development |

## PR/MR Parameters

Configure PR/MR parameters in the `git.pr` section of your configuration. Not all parameters are supported on every platform.

### Available Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `reviewers` | `string[]` | Usernames of requested reviewers |
| `labels` | `string[]` | Labels to apply to the PR/MR |
| `draft` | `boolean` | Create as draft PR/MR |
| `template` | `string` | Path to PR/MR body template file |
| `milestone` | `string` | Milestone to associate with the PR/MR |
| `linkedIssues` | `string[]` | Issue identifiers to link to the PR/MR |

### Platform Support Matrix

| Parameter | GitHub | GitHub Enterprise | Bitbucket | Bitbucket Server | GitLab | Azure DevOps |
|-----------|--------|-------------------|-----------|------------------|--------|--------------|
| reviewers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| labels | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| draft | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| template | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| milestone | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| linkedIssues | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |

### Configuration Example

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/owner/repo.git",
    "pr": {
      "target": "main",
      "reviewers": ["alice", "bob"],
      "labels": ["release", "automated"],
      "draft": false,
      "template": ".github/PULL_REQUEST_TEMPLATE.md",
      "milestone": "v2.0",
      "linkedIssues": ["#42", "#108"]
    }
  }
}
```

> **Note:** Unsupported parameters for a given platform are silently ignored. No error is raised.

## Related Documentation

- [CI/CD Examples](./ci-examples.md) — ready-to-use CI configurations with token setup for each platform
- [Configuration Reference](./configuration-reference.md) — full description of all `git.*` configuration fields
- [Failure Matrix](./failure-matrix.md) — exit codes related to authentication and network errors (`CONFIG_ERROR`, `NETWORK_ERROR`)
