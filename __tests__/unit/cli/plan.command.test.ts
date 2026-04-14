// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { runPlanCommand, PlanCommandDeps } from '../../../src/cli/commands/plan.command';
import { DryRunPlan, Reporter, createReporter } from '../../../src/core/reporter';
import { PipelineOpts, PipelineDeps } from '../../../src/core/pipeline';
import { PassThrough } from 'stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<DryRunPlan> = {}): DryRunPlan {
  return {
    dryRun: true,
    currentVersion: '1.0.0',
    nextVersion: '1.0.1',
    semver: 'patch',
    branch: 'version/patch/1.0.1/fix',
    tag: '1.0.1--fix',
    commitMessage: 'patch version 1.0.1',
    pullRequestUrl: null,
    steps: [
      'npm --no-git-tag-version version patch --message "patch version 1.0.1"',
      'git checkout -b version/patch/1.0.1/fix',
      'git tag --annotate 1.0.1--fix --message "patch version 1.0.1"',
      'git commit --all --message "patch version 1.0.1"',
    ],
    ...overrides,
  };
}

function makeDeps(overrides: {
  plan?: DryRunPlan;
  json?: boolean;
} = {}): { deps: PlanCommandDeps; stdout: PassThrough; runPipelineMock: jest.Mock } {
  const plan = overrides.plan ?? makePlan();
  const runPipelineMock = jest.fn().mockResolvedValue(plan);
  const stdout = new PassThrough();
  const reporter = createReporter({ json: overrides.json ?? false });

  const deps: PlanCommandDeps = {
    runPipeline: runPipelineMock,
    pipelineDeps: {} as PipelineDeps,
    reporter,
    stdout,
  };

  return { deps, stdout, runPipelineMock };
}

function collectOutput(stream: PassThrough): string {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  return () => Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('plan.command', () => {
  it('delegates to runPipeline with dryRun: true', async () => {
    const { deps, runPipelineMock } = makeDeps();

    await runPlanCommand(
      { semver: 'patch', branch: 'fix', push: false, json: false },
      deps,
    );

    expect(runPipelineMock).toHaveBeenCalledTimes(1);
    const [pipelineOpts] = runPipelineMock.mock.calls[0];
    expect(pipelineOpts.dryRun).toBe(true);
    expect(pipelineOpts.semver).toBe('patch');
    expect(pipelineOpts.branch).toBe('fix');
    expect(pipelineOpts.push).toBe(false);
  });

  it('passes all parameters to pipeline', async () => {
    const { deps, runPipelineMock } = makeDeps();

    await runPlanCommand(
      { semver: 'minor', branch: 'feat', push: true, preid: 'beta', json: false },
      deps,
    );

    const [pipelineOpts] = runPipelineMock.mock.calls[0];
    expect(pipelineOpts).toMatchObject({
      semver: 'minor',
      branch: 'feat',
      push: true,
      preid: 'beta',
      dryRun: true,
      json: false,
      verbose: false,
    });
  });

  it('returns the DryRunPlan from pipeline', async () => {
    const plan = makePlan({ nextVersion: '2.0.0' });
    const { deps } = makeDeps({ plan });

    const result = await runPlanCommand(
      { semver: 'major', branch: 'release', push: false, json: false },
      deps,
    );

    expect(result).toBe(plan);
    expect(result.nextVersion).toBe('2.0.0');
    expect(result.dryRun).toBe(true);
  });

  it('writes human-readable output to stdout', async () => {
    const plan = makePlan();
    const { deps, stdout } = makeDeps({ plan, json: false });

    let output = '';
    stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });

    await runPlanCommand(
      { semver: 'patch', branch: 'fix', push: false, json: false },
      deps,
    );

    expect(output).toContain('Dry run');
    expect(output).toContain('1.0.1');
    expect(output).toContain('patch');
  });

  it('writes JSON output to stdout when json: true', async () => {
    const plan = makePlan();
    const { deps, stdout } = makeDeps({ plan, json: true });

    let output = '';
    stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });

    await runPlanCommand(
      { semver: 'patch', branch: 'fix', push: false, json: true },
      deps,
    );

    // Should be valid JSON
    const parsed = JSON.parse(output.trim());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.nextVersion).toBe('1.0.1');
    expect(parsed.semver).toBe('patch');
  });

  it('includes push steps when push: true', async () => {
    const plan = makePlan({
      pullRequestUrl: 'https://github.com/org/repo/compare/main...version/patch/1.0.1/fix',
      steps: [
        'npm --no-git-tag-version version patch --message "patch version 1.0.1"',
        'git checkout -b version/patch/1.0.1/fix',
        'git tag --annotate 1.0.1--fix --message "patch version 1.0.1"',
        'git commit --all --message "patch version 1.0.1"',
        'git push origin version/patch/1.0.1/fix --follow-tags',
      ],
    });
    const { deps, runPipelineMock } = makeDeps({ plan });

    await runPlanCommand(
      { semver: 'patch', branch: 'fix', push: true, json: false },
      deps,
    );

    const [pipelineOpts] = runPipelineMock.mock.calls[0];
    expect(pipelineOpts.push).toBe(true);
  });

  it('propagates pipeline errors', async () => {
    const runPipelineMock = jest.fn().mockRejectedValue(new Error('pipeline failed'));
    const stdout = new PassThrough();
    const deps: PlanCommandDeps = {
      runPipeline: runPipelineMock,
      pipelineDeps: {} as PipelineDeps,
      reporter: createReporter({ json: false }),
      stdout,
    };

    await expect(
      runPlanCommand(
        { semver: 'patch', branch: 'fix', push: false, json: false },
        deps,
      ),
    ).rejects.toThrow('pipeline failed');
  });
});
