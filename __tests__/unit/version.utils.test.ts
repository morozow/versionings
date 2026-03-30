// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import {
  composeVersionBranchName,
  composeVersionTagName,
  AVAILABLE_SEMVERS,
  preidParam,
  semverMessage,
  generatePullRequestUrl,
} from '../../version.utils';
import type { VersioningsConfig } from '../../config.validator';

const mockConfig = {
  git: {
    platform: 'github',
    url: 'https://github.com/user/repo.git',
    branchType: { version: 'version' },
    pr: { target: 'develop' },
    limits: { branchMaxCommentLength: 96 },
    remote: 'origin',
    commit: {
      message: {
        semver: {
          patch: 'Patch: v%s.',
          minor: 'Minor: v%s.',
          major: 'Release: v%s.',
          prepatch: 'Preparing patch: v%s.',
          preminor: 'Preparing minor: v%s.',
          premajor: 'Preparing release: v%s.',
          prerelease: 'Preparing: v%s.',
        },
      },
    },
  },
  package: {
    semver: {
      patch: 'patch',
      prepatch: 'prepatch',
      minor: 'minor',
      preminor: 'preminor',
      premajor: 'premajor',
      prerelease: 'prerelease',
      major: 'major',
    },
  },
} as unknown as VersioningsConfig;

describe('composeVersionBranchName()', () => {
  test('returns correct format version/<type>/<version>/<comment>', () => {
    const result = composeVersionBranchName('patch', '1.2.3', 'fix-login', mockConfig);
    expect(result).toBe('version/patch/1.2.3/fix-login');
  });

  test('uses the semver type from config.package.semver', () => {
    const result = composeVersionBranchName('major', '2.0.0', 'release', mockConfig);
    expect(result).toBe('version/major/2.0.0/release');
  });

  test('handles prerelease type', () => {
    const result = composeVersionBranchName('prerelease', '1.0.0-rc.1', 'beta', mockConfig);
    expect(result).toBe('version/prerelease/1.0.0-rc.1/beta');
  });

  test('uses defaults when config is not provided', () => {
    const result = composeVersionBranchName('patch', '1.2.3', 'fix-login');
    expect(result).toBe('version/patch/1.2.3/fix-login');
  });
});

describe('composeVersionTagName()', () => {
  test('returns correct format <version>--<comment>', () => {
    const result = composeVersionTagName('patch', '1.2.3', 'fix-login');
    expect(result).toBe('1.2.3--fix-login');
  });

  test('tag name does not include semver type', () => {
    const result = composeVersionTagName('major', '2.0.0', 'release');
    expect(result).toBe('2.0.0--release');
  });
});

describe('AVAILABLE_SEMVERS', () => {
  test('contains all 7 semver types', () => {
    expect(AVAILABLE_SEMVERS).toHaveLength(7);
  });

  test('includes each expected semver type', () => {
    const expected = ['patch', 'prepatch', 'minor', 'preminor', 'premajor', 'prerelease', 'major'];
    expected.forEach((type) => {
      expect(AVAILABLE_SEMVERS).toContain(type);
    });
  });
});

describe('preidParam()', () => {
  test('returns --preid=<value> when preid is provided', () => {
    expect(preidParam('beta')).toBe('--preid=beta');
  });

  test('returns --preid=<value> for numeric preid', () => {
    expect(preidParam('rc')).toBe('--preid=rc');
  });

  test('returns empty string when preid is undefined', () => {
    expect(preidParam()).toBe('');
  });

  test('returns empty string when preid is empty string', () => {
    expect(preidParam('')).toBe('');
  });
});

describe('semverMessage()', () => {
  test('replaces v%s with version string for patch', () => {
    const result = semverMessage('patch', '1.2.3', mockConfig);
    expect(result).toBe('Patch: 1.2.3.');
  });

  test('replaces v%s with version string for major', () => {
    const result = semverMessage('major', '2.0.0', mockConfig);
    expect(result).toBe('Release: 2.0.0.');
  });

  test('replaces v%s with version string for prerelease', () => {
    const result = semverMessage('prerelease', '1.0.0-rc.1', mockConfig);
    expect(result).toBe('Preparing: 1.0.0-rc.1.');
  });
});

describe('generatePullRequestUrl()', () => {
  test('returns a URL containing the branch name for github platform', () => {
    const branch = 'version/patch/1.2.3/fix-login';
    const url = generatePullRequestUrl(branch, mockConfig);
    expect(url).toContain(branch);
  });

  test('returns a github compare URL format', () => {
    const branch = 'version/minor/1.3.0/new-feature';
    const url = generatePullRequestUrl(branch, mockConfig);
    expect(url).toContain('/compare/');
    expect(url).toContain('develop...');
    expect(url).toContain(branch);
  });

  test('includes expand=1 query parameter', () => {
    const branch = 'version/patch/1.0.1/hotfix';
    const url = generatePullRequestUrl(branch, mockConfig);
    expect(url).toContain('expand=1');
  });

  test('uses the repo URL from config', () => {
    const branch = 'version/patch/1.0.0/test';
    const url = generatePullRequestUrl(branch, mockConfig);
    expect(url).toContain('github.com/user/repo');
  });
});
