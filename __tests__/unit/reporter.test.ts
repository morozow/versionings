/* Versioning automation tool, 2018-present */

import { createReporter } from '../../reporter';
import type { PipelineResult, DryRunPlan } from '../../reporter';
import { VersioningsError } from '../../errors';

const successResult: PipelineResult = {
  success: true,
  version: '1.2.3',
  previousVersion: '1.2.2',
  semver: 'patch',
  branch: 'version/patch/1.2.3/fix-login',
  tag: '1.2.3--fix-login',
  pullRequestUrl: 'https://github.com/user/repo/compare/develop...branch',
  exitCode: 0,
};

const errorResult = new VersioningsError(1, 'Config missing', { expectedPath: './version.json' });

const dryRunPlan: DryRunPlan = {
  dryRun: true,
  currentVersion: '1.2.2',
  nextVersion: '1.2.3',
  semver: 'patch',
  branch: 'version/patch/1.2.3/fix-login',
  tag: '1.2.3--fix-login',
  commitMessage: 'Patch: v1.2.3. You SHOULD consider changes.',
  pullRequestUrl: null,
  steps: ['npm --no-git-tag-version version patch', 'git checkout -b ...'],
};

describe('createReporter — JSON mode', () => {
  const reporter = createReporter({ json: true });

  test('reportSuccess — contains all required fields and is parseable JSON', () => {
    const output = reporter.reportSuccess(successResult);
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(true);
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.previousVersion).toBe('1.2.2');
    expect(parsed.semver).toBe('patch');
    expect(parsed.branch).toBe('version/patch/1.2.3/fix-login');
    expect(parsed.tag).toBe('1.2.3--fix-login');
    expect(parsed.pullRequestUrl).toBe('https://github.com/user/repo/compare/develop...branch');
    expect(parsed.exitCode).toBe(0);
  });

  test('reportError — contains success:false, exitCode, error object with code/message/details', () => {
    const output = reporter.reportError(errorResult);
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(false);
    expect(parsed.exitCode).toBe(1);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('CONFIG_ERROR');
    expect(parsed.error.message).toBe('Config missing');
    expect(parsed.error.details).toEqual({ expectedPath: './version.json' });
  });

  test('reportDryRun — contains all DryRunPlan fields', () => {
    const output = reporter.reportDryRun(dryRunPlan);
    const parsed = JSON.parse(output);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.currentVersion).toBe('1.2.2');
    expect(parsed.nextVersion).toBe('1.2.3');
    expect(parsed.semver).toBe('patch');
    expect(parsed.branch).toBe('version/patch/1.2.3/fix-login');
    expect(parsed.tag).toBe('1.2.3--fix-login');
    expect(parsed.commitMessage).toBe('Patch: v1.2.3. You SHOULD consider changes.');
    expect(parsed.pullRequestUrl).toBeNull();
    expect(parsed.steps).toEqual([
      'npm --no-git-tag-version version patch',
      'git checkout -b ...',
    ]);
  });

  test('no ANSI escape sequences in JSON output', () => {
    // eslint-disable-next-line no-control-regex
    const ansiPattern = /\x1b\[/;
    expect(ansiPattern.test(reporter.reportSuccess(successResult))).toBe(false);
    expect(ansiPattern.test(reporter.reportError(errorResult))).toBe(false);
    expect(ansiPattern.test(reporter.reportDryRun(dryRunPlan))).toBe(false);
  });

  test('JSON output ends with newline', () => {
    expect(reporter.reportSuccess(successResult)).toMatch(/\n$/);
    expect(reporter.reportError(errorResult)).toMatch(/\n$/);
    expect(reporter.reportDryRun(dryRunPlan)).toMatch(/\n$/);
  });
});

describe('createReporter — human-readable mode', () => {
  const reporter = createReporter({ json: false });

  test('reportSuccess — contains version, branch, and semver', () => {
    const output = reporter.reportSuccess(successResult);
    expect(output).toContain('1.2.3');
    expect(output).toContain('version/patch/1.2.3/fix-login');
    expect(output).toContain('patch');
  });

  test('reportError — contains error code name and message', () => {
    const output = reporter.reportError(errorResult);
    expect(output).toContain('CONFIG_ERROR');
    expect(output).toContain('Config missing');
    expect(output).toContain('expectedPath');
  });
});
