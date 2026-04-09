// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { createUrlParser, type UrlParser, type ParsedUrl } from '../../url.parser';
import { VersioningsError, EXIT_CODES } from '../../errors';

let parser: UrlParser;

beforeEach(() => {
  parser = createUrlParser();
});

// --- GitHub (cloud) ---

describe('GitHub HTTPS', () => {
  test('parses https://github.com/owner/repo', () => {
    const result = parser.parse('https://github.com/owner/repo', 'github');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo' });
  });

  test('parses https://github.com/owner/repo.git (strips .git)', () => {
    const result = parser.parse('https://github.com/owner/repo.git', 'github');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo' });
  });

  test('parses URL with trailing slash', () => {
    const result = parser.parse('https://github.com/owner/repo/', 'github');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo' });
  });
});

describe('GitHub SSH', () => {
  test('parses git@github.com:owner/repo.git', () => {
    const result = parser.parse('git@github.com:owner/repo.git', 'github');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo' });
  });

  test('parses ssh://git@github.com/owner/repo.git', () => {
    const result = parser.parse('ssh://git@github.com/owner/repo.git', 'github');
    expect(result).toEqual({ platform: 'github', owner: 'owner', repo: 'repo' });
  });
});

// --- GitHub Enterprise ---

describe('GitHub Enterprise (self-hosted)', () => {
  test('parses HTTPS with custom domain', () => {
    const result = parser.parse('https://github.mycompany.com/team/project', 'github-enterprise');
    expect(result).toEqual({ platform: 'github-enterprise', owner: 'team', repo: 'project' });
  });

  test('parses SSH with custom domain', () => {
    const result = parser.parse('git@github.mycompany.com:team/project.git', 'github-enterprise');
    expect(result).toEqual({ platform: 'github-enterprise', owner: 'team', repo: 'project' });
  });
});


// --- GitLab ---

describe('GitLab', () => {
  test('parses simple namespace https://gitlab.com/owner/project', () => {
    const result = parser.parse('https://gitlab.com/owner/project', 'gitlab');
    expect(result).toEqual({ platform: 'gitlab', namespacePath: 'owner', project: 'project' });
  });

  test('parses nested groups https://gitlab.com/group/subgroup/project', () => {
    const result = parser.parse('https://gitlab.com/group/subgroup/project', 'gitlab');
    expect(result).toEqual({ platform: 'gitlab', namespacePath: 'group/subgroup', project: 'project' });
  });

  test('parses deeply nested groups', () => {
    const result = parser.parse('https://gitlab.com/a/b/c/d/project', 'gitlab');
    expect(result).toEqual({ platform: 'gitlab', namespacePath: 'a/b/c/d', project: 'project' });
  });

  test('parses SSH format git@gitlab.com:owner/project.git', () => {
    const result = parser.parse('git@gitlab.com:owner/project.git', 'gitlab');
    expect(result).toEqual({ platform: 'gitlab', namespacePath: 'owner', project: 'project' });
  });
});

// --- Bitbucket Cloud ---

describe('Bitbucket Cloud', () => {
  test('parses https://bitbucket.org/workspace/repo', () => {
    const result = parser.parse('https://bitbucket.org/workspace/repo', 'bitbucket');
    expect(result).toEqual({ platform: 'bitbucket', workspace: 'workspace', repoSlug: 'repo' });
  });

  test('parses SSH format git@bitbucket.org:workspace/repo.git', () => {
    const result = parser.parse('git@bitbucket.org:workspace/repo.git', 'bitbucket');
    expect(result).toEqual({ platform: 'bitbucket', workspace: 'workspace', repoSlug: 'repo' });
  });
});

// --- Bitbucket Server ---

describe('Bitbucket Server', () => {
  test('parses HTTPS with /scm/ prefix: https://myserver.com/scm/PROJECT/repo', () => {
    const result = parser.parse('https://myserver.com/scm/PROJECT/repo', 'bitbucket-server');
    expect(result).toEqual({ platform: 'bitbucket-server', projectKey: 'PROJECT', repositorySlug: 'repo' });
  });

  test('parses SSH format git@myserver.com:PROJECT/repo.git', () => {
    const result = parser.parse('git@myserver.com:PROJECT/repo.git', 'bitbucket-server');
    expect(result).toEqual({ platform: 'bitbucket-server', projectKey: 'PROJECT', repositorySlug: 'repo' });
  });

  test('parses SSH with port git@myserver.com:7999/PROJECT/repo.git', () => {
    const result = parser.parse('git@myserver.com:7999/PROJECT/repo.git', 'bitbucket-server');
    expect(result).toEqual({ platform: 'bitbucket-server', projectKey: 'PROJECT', repositorySlug: 'repo' });
  });
});

// --- Azure DevOps ---

describe('Azure DevOps', () => {
  test('parses https://dev.azure.com/org/project/_git/repo', () => {
    const result = parser.parse('https://dev.azure.com/org/project/_git/repo', 'azure-devops');
    expect(result).toEqual({ platform: 'azure-devops', organization: 'org', project: 'project', repo: 'repo' });
  });

  test('parses SSH format git@ssh.dev.azure.com:v3/org/project/repo', () => {
    const result = parser.parse('git@ssh.dev.azure.com:v3/org/project/repo', 'azure-devops');
    expect(result).toEqual({ platform: 'azure-devops', organization: 'org', project: 'project', repo: 'repo' });
  });
});

// --- Invalid URLs → VersioningsError ---

describe('Invalid URLs', () => {
  test('throws VersioningsError with CONFIG_ERROR for empty URL', () => {
    expect(() => parser.parse('', 'github')).toThrow(VersioningsError);
    try {
      parser.parse('', 'github');
    } catch (err) {
      expect(err).toBeInstanceOf(VersioningsError);
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  test('throws VersioningsError for GitHub URL with only owner (missing repo)', () => {
    expect(() => parser.parse('https://github.com/owner', 'github')).toThrow(VersioningsError);
    try {
      parser.parse('https://github.com/owner', 'github');
    } catch (err) {
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  test('throws VersioningsError for Azure DevOps URL missing _git segment', () => {
    expect(() => parser.parse('https://dev.azure.com/org/project/repo', 'azure-devops')).toThrow(VersioningsError);
  });

  test('throws VersioningsError for unsupported platform', () => {
    expect(() => parser.parse('https://example.com/owner/repo', 'unknown-platform')).toThrow(VersioningsError);
    try {
      parser.parse('https://example.com/owner/repo', 'unknown-platform');
    } catch (err) {
      expect((err as VersioningsError).code).toBe(EXIT_CODES.CONFIG_ERROR);
      expect((err as VersioningsError).message).toContain('Unsupported platform');
    }
  });

  test('error message contains platform name and expected formats', () => {
    try {
      parser.parse('https://github.com/owner', 'github');
    } catch (err) {
      const msg = (err as VersioningsError).message;
      expect(msg).toContain('github');
      expect(msg).toContain('Expected formats');
    }
  });
});

// --- Round-trip: format(parse(url)) ---

describe('Round-trip: format(parse(url))', () => {
  test('GitHub HTTPS round-trip', () => {
    const url = 'https://github.com/facebook/react';
    const parsed = parser.parse(url, 'github');
    expect(parser.format(parsed)).toBe(url);
  });

  test('GitHub HTTPS with .git normalizes to canonical form', () => {
    const parsed = parser.parse('https://github.com/facebook/react.git', 'github');
    expect(parser.format(parsed)).toBe('https://github.com/facebook/react');
  });

  test('GitHub SSH normalizes to HTTPS canonical form', () => {
    const parsed = parser.parse('git@github.com:facebook/react.git', 'github');
    expect(parser.format(parsed)).toBe('https://github.com/facebook/react');
  });

  test('GitLab nested groups round-trip', () => {
    const url = 'https://gitlab.com/group/subgroup/project';
    const parsed = parser.parse(url, 'gitlab');
    expect(parser.format(parsed)).toBe(url);
  });

  test('Bitbucket Cloud round-trip', () => {
    const url = 'https://bitbucket.org/atlassian/aui';
    const parsed = parser.parse(url, 'bitbucket');
    expect(parser.format(parsed)).toBe(url);
  });

  test('Bitbucket Server round-trip (HTTPS with /scm/)', () => {
    const url = 'https://myserver.com/scm/PROJECT/repo';
    const parsed = parser.parse(url, 'bitbucket-server');
    // format uses default host 'bitbucket-server' since parsed doesn't carry host
    const formatted = parser.format(parsed);
    expect(formatted).toContain('/scm/PROJECT/repo');
  });

  test('Azure DevOps round-trip', () => {
    const url = 'https://dev.azure.com/myorg/myproject/_git/myrepo';
    const parsed = parser.parse(url, 'azure-devops');
    expect(parser.format(parsed)).toBe(url);
  });
});
