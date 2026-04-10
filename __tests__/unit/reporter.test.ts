// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

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

// --- Fixtures for new reporter methods ---

import type { ValidateResult, DoctorCheck } from '../../reporter';
import type { ConfigProvenance } from '../../config.merger';

const validateResultPass: ValidateResult = {
  valid: true,
  checks: [
    { name: 'config', status: 'pass', details: 'Configuration is valid' },
    { name: 'git-remote', status: 'warn', details: 'Remote not verified' },
  ],
  provenance: {
    'git.platform': { value: 'github', source: 'version.json' },
  },
};

const validateResultFail: ValidateResult = {
  valid: false,
  checks: [
    { name: 'config', status: 'fail', details: 'Missing required field git.url' },
    { name: 'git-remote', status: 'pass', details: 'Remote OK' },
  ],
  provenance: {},
};

const doctorChecks: DoctorCheck[] = [
  { name: 'Node.js', status: 'pass', found: 'v20.11.0', expected: '>=16.0.0' },
  { name: 'Git', status: 'pass', found: '2.43.0' },
  { name: 'Config', status: 'fail', found: 'missing', expected: 'version.json or .versioningsrc' },
  { name: 'package.json', status: 'warn', found: 'present, no versionings section' },
];

const provenance: ConfigProvenance = {
  'git.url': { value: 'https://github.com/org/repo', source: '.versioningsrc' },
  'git.platform': { value: 'github', source: 'env' },
  'git.pr.target': { value: 'main', source: 'defaults' },
};

// --- JSON mode tests for new methods ---

describe('createReporter — JSON mode (new methods)', () => {
  const reporter = createReporter({ json: true });
  // eslint-disable-next-line no-control-regex
  const ansiPattern = /\x1b\[/;

  test('reportValidation — valid JSON with all fields', () => {
    const output = reporter.reportValidation(validateResultPass);
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
    expect(parsed.checks).toHaveLength(2);
    expect(parsed.checks[0].name).toBe('config');
    expect(parsed.checks[0].status).toBe('pass');
    expect(parsed.provenance).toBeDefined();
    expect(parsed.provenance['git.platform'].source).toBe('version.json');
  });

  test('reportValidation — no ANSI in JSON, ends with newline', () => {
    const output = reporter.reportValidation(validateResultPass);
    expect(ansiPattern.test(output)).toBe(false);
    expect(output).toMatch(/\n$/);
  });

  test('reportDoctor — valid JSON array with all checks', () => {
    const output = reporter.reportDoctor(doctorChecks);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(4);
    expect(parsed[0].name).toBe('Node.js');
    expect(parsed[0].found).toBe('v20.11.0');
    expect(parsed[0].expected).toBe('>=16.0.0');
    expect(parsed[2].status).toBe('fail');
  });

  test('reportDoctor — no ANSI in JSON, ends with newline', () => {
    const output = reporter.reportDoctor(doctorChecks);
    expect(ansiPattern.test(output)).toBe(false);
    expect(output).toMatch(/\n$/);
  });

  test('reportProvenance — valid JSON with field paths and sources', () => {
    const output = reporter.reportProvenance(provenance);
    const parsed = JSON.parse(output);
    expect(parsed['git.platform'].value).toBe('github');
    expect(parsed['git.platform'].source).toBe('env');
    expect(parsed['git.url'].source).toBe('.versioningsrc');
  });

  test('reportProvenance — no ANSI in JSON, ends with newline', () => {
    const output = reporter.reportProvenance(provenance);
    expect(ansiPattern.test(output)).toBe(false);
    expect(output).toMatch(/\n$/);
  });

  test('reportConfirmPlan — valid JSON with all DryRunPlan fields', () => {
    const output = reporter.reportConfirmPlan(dryRunPlan);
    const parsed = JSON.parse(output);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.currentVersion).toBe('1.2.2');
    expect(parsed.nextVersion).toBe('1.2.3');
    expect(parsed.semver).toBe('patch');
    expect(parsed.branch).toBe('version/patch/1.2.3/fix-login');
    expect(parsed.tag).toBe('1.2.3--fix-login');
    expect(parsed.steps).toEqual([
      'npm --no-git-tag-version version patch',
      'git checkout -b ...',
    ]);
  });

  test('reportConfirmPlan — no ANSI in JSON, ends with newline', () => {
    const output = reporter.reportConfirmPlan(dryRunPlan);
    expect(ansiPattern.test(output)).toBe(false);
    expect(output).toMatch(/\n$/);
  });
});

// --- Human-readable mode tests for new methods ---

describe('createReporter — human-readable mode (new methods)', () => {
  const reporter = createReporter({ json: false });

  test('reportValidation — shows "passed" with check icons for valid result', () => {
    const output = reporter.reportValidation(validateResultPass);
    expect(output).toContain('passed');
    expect(output).toContain('✓');
    expect(output).toContain('⚠');
    expect(output).toContain('config');
    expect(output).toContain('Configuration is valid');
  });

  test('reportValidation — shows "failed" with fail icon for invalid result', () => {
    const output = reporter.reportValidation(validateResultFail);
    expect(output).toContain('failed');
    expect(output).toContain('✗');
    expect(output).toContain('Missing required field git.url');
  });

  test('reportDoctor — shows status icons, found and expected values', () => {
    const output = reporter.reportDoctor(doctorChecks);
    expect(output).toContain('✓');
    expect(output).toContain('✗');
    expect(output).toContain('⚠');
    expect(output).toContain('Node.js');
    expect(output).toContain('found: v20.11.0');
    expect(output).toContain('expected: >=16.0.0');
  });

  test('reportDoctor — check without expected omits expected field', () => {
    const output = reporter.reportDoctor(doctorChecks);
    // "Git" check has no expected — should show "found:" but not "expected:" on that line
    const gitLine = output.split('\n').find((l: string) => l.includes('Git'));
    expect(gitLine).toContain('found: 2.43.0');
    expect(gitLine).not.toContain('expected:');
  });

  test('reportProvenance — shows sorted field paths with sources', () => {
    const output = reporter.reportProvenance(provenance);
    expect(output).toContain('git.platform');
    expect(output).toContain('github');
    expect(output).toContain('source: env');
    expect(output).toContain('git.url');
    expect(output).toContain('source: .versioningsrc');
    // Verify sorted order: git.platform before git.pr.target before git.url
    const lines = output.split('\n');
    const platformIdx = lines.findIndex((l: string) => l.includes('git.platform'));
    const prTargetIdx = lines.findIndex((l: string) => l.includes('git.pr.target'));
    const urlIdx = lines.findIndex((l: string) => l.includes('git.url'));
    expect(platformIdx).toBeLessThan(prTargetIdx);
    expect(prTargetIdx).toBeLessThan(urlIdx);
  });

  test('reportConfirmPlan — shows plan details with colored values', () => {
    const output = reporter.reportConfirmPlan(dryRunPlan);
    expect(output).toContain('The following operations will be performed');
    expect(output).toContain('1.2.2');
    expect(output).toContain('1.2.3');
    expect(output).toContain('version/patch/1.2.3/fix-login');
    expect(output).toContain('1.2.3--fix-login');
    expect(output).toContain('Steps:');
    // ANSI colors should be present in human-readable mode
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(output)).toBe(true);
  });

  test('reportConfirmPlan — pullRequestUrl null is omitted', () => {
    const output = reporter.reportConfirmPlan(dryRunPlan);
    expect(output).not.toContain('Pull request URL');
  });

  test('reportConfirmPlan — pullRequestUrl shown when present', () => {
    const planWithPR: DryRunPlan = {
      ...dryRunPlan,
      pullRequestUrl: 'https://github.com/user/repo/compare/develop...branch',
    };
    const output = reporter.reportConfirmPlan(planWithPR);
    expect(output).toContain('Pull request URL');
    expect(output).toContain('https://github.com/user/repo/compare/develop...branch');
  });
});


// --- PR/MR output tests (Task 8.4) ---

describe('createReporter — JSON mode (PR/MR output)', () => {
  const reporter = createReporter({ json: true });

  const resultWithPR: PipelineResult = {
    success: true,
    version: '1.2.3',
    previousVersion: '1.2.2',
    semver: 'patch',
    branch: 'version/patch/1.2.3/fix-login',
    tag: '1.2.3--fix-login',
    pullRequestUrl: null,
    exitCode: 0,
    pullRequest: {
      url: 'https://github.com/user/repo/pull/42',
      number: 42,
      status: 'created',
      fallbackReason: null,
      platform: 'github',
      warnings: [],
    },
  };

  test('JSON with pullRequest object — contains all PR fields', () => {
    const output = reporter.reportSuccess(resultWithPR);
    const parsed = JSON.parse(output);
    expect(parsed.pullRequest).toBeDefined();
    expect(parsed.pullRequest.url).toBe('https://github.com/user/repo/pull/42');
    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.status).toBe('created');
    expect(parsed.pullRequest.fallbackReason).toBeNull();
    expect(parsed.pullRequest.platform).toBe('github');
  });

  test('JSON with pullRequestUrl alias — equals pullRequest.url', () => {
    const output = reporter.reportSuccess(resultWithPR);
    const parsed = JSON.parse(output);
    expect(parsed.pullRequestUrl).toBe(parsed.pullRequest.url);
    expect(parsed.pullRequestUrl).toBe('https://github.com/user/repo/pull/42');
  });

  test('JSON without pullRequest — pullRequestUrl preserved from legacy field', () => {
    const output = reporter.reportSuccess(successResult);
    const parsed = JSON.parse(output);
    expect(parsed.pullRequest).toBeUndefined();
    expect(parsed.pullRequestUrl).toBe('https://github.com/user/repo/compare/develop...branch');
  });

  test('JSON with fallback pullRequest — includes fallbackReason', () => {
    const fallbackResult: PipelineResult = {
      ...resultWithPR,
      pullRequest: {
        url: 'https://github.com/user/repo/compare/develop...branch',
        number: null,
        status: 'fallback',
        fallbackReason: 'no_token',
        platform: 'github',
        warnings: [],
      },
    };
    const output = reporter.reportSuccess(fallbackResult);
    const parsed = JSON.parse(output);
    expect(parsed.pullRequest.status).toBe('fallback');
    expect(parsed.pullRequest.fallbackReason).toBe('no_token');
    expect(parsed.pullRequest.number).toBeNull();
  });
});

describe('createReporter — human-readable mode (PR/MR output)', () => {
  const reporter = createReporter({ json: false });

  test('human-readable created — "Pull request #N created: URL (Platform)"', () => {
    const result: PipelineResult = {
      success: true,
      version: '1.2.3',
      previousVersion: '1.2.2',
      semver: 'patch',
      branch: 'version/patch/1.2.3/fix-login',
      tag: '1.2.3--fix-login',
      pullRequestUrl: null,
      exitCode: 0,
      pullRequest: {
        url: 'https://github.com/user/repo/pull/42',
        number: 42,
        status: 'created',
        fallbackReason: null,
        platform: 'github',
        warnings: [],
      },
    };
    const output = reporter.reportSuccess(result);
    expect(output).toContain('Pull request #42 created');
    expect(output).toContain('https://github.com/user/repo/pull/42');
    expect(output).toContain('(GitHub)');
  });

  test('human-readable fallback — "Pull request URL (fallback: reason): URL"', () => {
    const result: PipelineResult = {
      success: true,
      version: '1.2.3',
      previousVersion: '1.2.2',
      semver: 'patch',
      branch: 'version/patch/1.2.3/fix-login',
      tag: '1.2.3--fix-login',
      pullRequestUrl: null,
      exitCode: 0,
      pullRequest: {
        url: 'https://github.com/user/repo/compare/develop...branch',
        number: null,
        status: 'fallback',
        fallbackReason: 'no_token',
        platform: 'github',
        warnings: [],
      },
    };
    const output = reporter.reportSuccess(result);
    expect(output).toContain('Pull request URL (fallback: no_token)');
    expect(output).toContain('https://github.com/user/repo/compare/develop...branch');
  });

  test('human-readable draft — "(draft)" next to URL', () => {
    const result: PipelineResult = {
      success: true,
      version: '1.2.3',
      previousVersion: '1.2.2',
      semver: 'patch',
      branch: 'version/patch/1.2.3/fix-login',
      tag: '1.2.3--fix-login',
      pullRequestUrl: null,
      exitCode: 0,
      pullRequest: {
        url: 'https://github.com/user/repo/pull/42',
        number: 42,
        status: 'created',
        fallbackReason: null,
        platform: 'github',
        warnings: ['Created as draft pull request'],
      },
    };
    const output = reporter.reportSuccess(result);
    expect(output).toContain('(draft)');
    expect(output).toContain('#42 created');
  });

  test('GitLab — "Merge request" instead of "Pull request"', () => {
    const result: PipelineResult = {
      success: true,
      version: '1.2.3',
      previousVersion: '1.2.2',
      semver: 'patch',
      branch: 'version/patch/1.2.3/fix-login',
      tag: '1.2.3--fix-login',
      pullRequestUrl: null,
      exitCode: 0,
      pullRequest: {
        url: 'https://gitlab.com/user/repo/-/merge_requests/42',
        number: 42,
        status: 'created',
        fallbackReason: null,
        platform: 'gitlab',
        warnings: [],
      },
    };
    const output = reporter.reportSuccess(result);
    expect(output).toContain('Merge request !42 created');
    expect(output).toContain('(GitLab)');
    expect(output).not.toContain('Pull request');
  });

  test('dry-run with PR info — shows PR/MR creation method and parameters', () => {
    const plan: DryRunPlan = {
      ...dryRunPlan,
      pullRequestUrl: 'https://github.com/user/repo/compare/develop...branch',
      pullRequest: {
        mode: 'auto',
        platform: 'github',
        reviewers: ['alice', 'bob'],
        labels: ['release'],
        draft: true,
        hasToken: true,
      },
    };
    const output = reporter.reportDryRun(plan);
    expect(output).toContain('PR/MR creation: API');
    expect(output).toContain('mode: auto');
    expect(output).toContain('platform: github');
    expect(output).toContain('Reviewers: alice, bob');
    expect(output).toContain('Labels: release');
    expect(output).toContain('Draft: yes');
  });

  test('dry-run without token — shows URL method', () => {
    const plan: DryRunPlan = {
      ...dryRunPlan,
      pullRequestUrl: 'https://github.com/user/repo/compare/develop...branch',
      pullRequest: {
        mode: 'auto',
        platform: 'github',
        hasToken: false,
      },
    };
    const output = reporter.reportDryRun(plan);
    expect(output).toContain('PR/MR creation: URL');
  });
});


// --- Strategy and policyCheck output tests (Task 11.5) ---

import { EXIT_CODES } from '../../errors';

describe('reporter — strategy and policyCheck output', () => {
  // JSON mode tests
  test('reportSuccess JSON includes strategy field when present', () => {
    const reporter = createReporter({ json: true });
    const result: PipelineResult = {
      ...successResult,
      strategy: 'trunk-based',
    };
    const output = reporter.reportSuccess(result);
    const parsed = JSON.parse(output);
    expect(parsed.strategy).toBe('trunk-based');
  });

  test('reportSuccess JSON includes policyCheck field when present', () => {
    const reporter = createReporter({ json: true });
    const result: PipelineResult = {
      ...successResult,
      policyCheck: { warnings: ['test'], errors: [], protectionInfo: null },
    };
    const output = reporter.reportSuccess(result);
    const parsed = JSON.parse(output);
    expect(parsed.policyCheck).toBeDefined();
    expect(parsed.policyCheck.warnings).toEqual(['test']);
    expect(parsed.policyCheck.errors).toEqual([]);
    expect(parsed.policyCheck.protectionInfo).toBeNull();
  });

  test('reportSuccess JSON omits strategy when absent (backward compatibility)', () => {
    const reporter = createReporter({ json: true });
    const output = reporter.reportSuccess(successResult);
    const parsed = JSON.parse(output);
    expect(parsed.strategy).toBeUndefined();
  });

  // Human-readable mode tests
  test('reportSuccess human-readable includes Strategy line when present', () => {
    const reporter = createReporter({ json: false });
    const result: PipelineResult = {
      ...successResult,
      strategy: 'git-flow',
    };
    const output = reporter.reportSuccess(result);
    expect(output).toContain('Strategy: git-flow');
  });

  test('reportSuccess human-readable omits Strategy line when absent', () => {
    const reporter = createReporter({ json: false });
    const output = reporter.reportSuccess(successResult);
    expect(output).not.toContain('Strategy:');
  });

  // POLICY_VIOLATION error tests
  test('reportError JSON for POLICY_VIOLATION includes error code', () => {
    const reporter = createReporter({ json: true });
    const err = new VersioningsError(EXIT_CODES.POLICY_VIOLATION, 'Branch "main" is protected');
    const output = reporter.reportError(err);
    const parsed = JSON.parse(output);
    expect(parsed.error.code).toBe('POLICY_VIOLATION');
    expect(parsed.exitCode).toBe(10);
    expect(parsed.success).toBe(false);
  });

  test('reportError human-readable for POLICY_VIOLATION includes code name', () => {
    const reporter = createReporter({ json: false });
    const err = new VersioningsError(EXIT_CODES.POLICY_VIOLATION, 'Branch "main" is protected');
    const output = reporter.reportError(err);
    expect(output).toContain('POLICY_VIOLATION');
    expect(output).toContain('exit code 10');
  });
});
