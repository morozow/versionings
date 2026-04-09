// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { mergeConfigs, ConfigSource, ConfigProvenance } from '../../config.merger';

describe('mergeConfigs', () => {
  test('merges two sources — last source wins for overlapping leaf fields', () => {
    const sources: ConfigSource[] = [
      { name: 'defaults', data: { git: { platform: 'github', remote: 'origin' } } },
      { name: 'version.json', data: { git: { platform: 'bitbucket' } } },
    ];

    const { merged } = mergeConfigs(sources);

    expect(merged.git.platform).toBe('bitbucket');
    expect(merged.git.remote).toBe('origin');
  });

  test('deep merges nested objects — preserves fields from lower-priority sources', () => {
    const sources: ConfigSource[] = [
      {
        name: 'defaults',
        data: {
          git: {
            platform: 'github',
            url: 'https://github.com/org/repo',
            pr: { target: 'main' },
            remote: 'origin',
          },
        },
      },
      {
        name: '.versioningsrc',
        data: {
          git: {
            url: 'https://github.com/org/other-repo',
            pr: { target: 'develop' },
          },
        },
      },
    ];

    const { merged } = mergeConfigs(sources);

    // Overridden by higher-priority source
    expect(merged.git.url).toBe('https://github.com/org/other-repo');
    expect(merged.git.pr.target).toBe('develop');
    // Preserved from lower-priority source (not overridden)
    expect(merged.git.platform).toBe('github');
    expect(merged.git.remote).toBe('origin');
  });

  test('last source wins priority across multiple sources', () => {
    const sources: ConfigSource[] = [
      { name: 'defaults', data: { git: { platform: 'github' } } },
      { name: 'version.json', data: { git: { platform: 'bitbucket' } } },
      { name: 'env', data: { git: { platform: 'github' } } },
      { name: 'cli', data: { git: { platform: 'bitbucket' } } },
    ];

    const { merged } = mergeConfigs(sources);

    // The last source ('cli') wins
    expect(merged.git.platform).toBe('bitbucket');
  });

  test('provenance tracks which source set each leaf field', () => {
    const sources: ConfigSource[] = [
      {
        name: 'defaults',
        data: { git: { platform: 'github', remote: 'origin', pr: { target: 'main' } } },
      },
      {
        name: '.versioningsrc',
        data: { git: { platform: 'bitbucket' } },
      },
      {
        name: 'env',
        data: { git: { pr: { target: 'develop' } } },
      },
    ];

    const { provenance } = mergeConfigs(sources);

    // platform was last set by '.versioningsrc'
    expect(provenance['git.platform']).toEqual({ value: 'bitbucket', source: '.versioningsrc' });
    // remote was only set by 'defaults'
    expect(provenance['git.remote']).toEqual({ value: 'origin', source: 'defaults' });
    // pr.target was last set by 'env'
    expect(provenance['git.pr.target']).toEqual({ value: 'develop', source: 'env' });
  });

  test('provenance reflects the last source that wrote each field', () => {
    const sources: ConfigSource[] = [
      { name: 'defaults', data: { git: { platform: 'github' } } },
      { name: 'version.json', data: { git: { platform: 'bitbucket' } } },
      { name: 'cli', data: { git: { platform: 'github' } } },
    ];

    const { provenance } = mergeConfigs(sources);

    // Even though value is 'github' again, source should be 'cli' (last writer)
    expect(provenance['git.platform']).toEqual({ value: 'github', source: 'cli' });
  });

  test('returns empty merged and provenance for empty sources array', () => {
    const { merged, provenance } = mergeConfigs([]);

    expect(merged).toEqual({});
    expect(provenance).toEqual({});
  });

  test('handles single source correctly', () => {
    const sources: ConfigSource[] = [
      {
        name: 'version.json',
        data: { git: { platform: 'github', url: 'https://github.com/org/repo' } },
      },
    ];

    const { merged, provenance } = mergeConfigs(sources);

    expect(merged).toEqual({ git: { platform: 'github', url: 'https://github.com/org/repo' } });
    expect(provenance['git.platform']).toEqual({ value: 'github', source: 'version.json' });
    expect(provenance['git.url']).toEqual({
      value: 'https://github.com/org/repo',
      source: 'version.json',
    });
  });

  test('deep merge preserves deeply nested fields from lower-priority sources', () => {
    const sources: ConfigSource[] = [
      {
        name: 'defaults',
        data: {
          git: {
            commit: { message: { semver: { patch: 'chore: bump', minor: 'feat: bump' } } },
          },
        },
      },
      {
        name: '.versioningsrc',
        data: {
          git: {
            commit: { message: { semver: { patch: 'fix: version bump' } } },
          },
        },
      },
    ];

    const { merged, provenance } = mergeConfigs(sources);

    // Overridden
    expect(merged.git.commit.message.semver.patch).toBe('fix: version bump');
    // Preserved from defaults
    expect(merged.git.commit.message.semver.minor).toBe('feat: bump');

    expect(provenance['git.commit.message.semver.patch']).toEqual({
      value: 'fix: version bump',
      source: '.versioningsrc',
    });
    expect(provenance['git.commit.message.semver.minor']).toEqual({
      value: 'feat: bump',
      source: 'defaults',
    });
  });

  test('skips undefined values in source data', () => {
    const sources: ConfigSource[] = [
      { name: 'defaults', data: { git: { platform: 'github', remote: 'origin' } } },
      { name: 'env', data: { git: { platform: undefined as any, remote: 'upstream' } } },
    ];

    const { merged, provenance } = mergeConfigs(sources);

    // platform should remain from defaults since env has undefined
    expect(merged.git.platform).toBe('github');
    expect(merged.git.remote).toBe('upstream');
    expect(provenance['git.platform']).toEqual({ value: 'github', source: 'defaults' });
    expect(provenance['git.remote']).toEqual({ value: 'upstream', source: 'env' });
  });
});
