// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
// Feature: core-ux-config-cli, Property 9 & Property 10: Command Router properties

import * as fc from 'fast-check';
import { PassThrough } from 'stream';
import { preprocessArgv, SUBCOMMANDS } from '../../../src/cli/command.router';
import { runPlanCommand, PlanCommandDeps } from '../../../src/cli/commands/plan.command';
import { runReleaseCommand, ReleaseCommandOpts, ReleaseCommandDeps } from '../../../src/cli/commands/release.command';
import { createReporter, DryRunPlan } from '../../../src/core/reporter';
import { PipelineOpts, PipelineDeps } from '../../../src/core/pipeline';
import { InteractionManager } from '../../../src/cli/interaction.manager';
import { OperationLog } from '../../../src/core/operation.log';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbSemver = fc.constantFrom('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease');

const arbBranch = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 1, maxLength: 80 },
).filter((s) => !/-{2,}/.test(s) && s.trim().length > 0);

const arbPush = fc.boolean();

const arbPreid = fc.option(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }),
  { nil: undefined },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(semver: string, branch: string, push: boolean, preid?: string): DryRunPlan {
  const version = '1.0.1';
  const branchName = `version/${semver}/${version}/${branch}`;
  const tagName = `${version}--${branch}`;
  const steps = [
    `npm --no-git-tag-version version ${semver}`,
    `git checkout -b ${branchName}`,
    `git tag --annotate ${tagName}`,
    `git commit --all`,
  ];
  if (push) {
    steps.push(`git push origin ${branchName} --follow-tags`);
  }
  return {
    dryRun: true,
    currentVersion: '1.0.0',
    nextVersion: version,
    semver,
    branch: branchName,
    tag: tagName,
    commitMessage: `${semver} version ${version}`,
    pullRequestUrl: push ? `https://github.com/org/repo/compare/main...${branchName}` : null,
    steps,
  };
}

function makeMockInteraction(): InteractionManager {
  return {
    isInteractive: jest.fn().mockReturnValue(false),
    confirm: jest.fn().mockResolvedValue(true),
  };
}

function makeMockOperationLog(): OperationLog {
  return {
    save: jest.fn().mockResolvedValue('/path/to/log.json'),
    loadLast: jest.fn().mockResolvedValue(null),
    loadFrom: jest.fn().mockRejectedValue(new Error('not found')),
  };
}

// ---------------------------------------------------------------------------
// Property 9: Equivalence of plan and release --dry-run
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 8.1**
 *
 * For any valid params {semver, branch, push, preid}, the output of
 * runPlanCommand SHALL be deeply equal to the output of
 * runReleaseCommand with dryRun: true and the same parameters.
 *
 * Both commands delegate to the same pipeline mock with dryRun: true,
 * so the returned DryRunPlan objects must be identical.
 */
describe('Property 9: Equivalence of plan and release --dry-run', () => {
  test('plan output equals release --dry-run output for any valid params', () => {
    fc.assert(
      fc.asyncProperty(arbSemver, arbBranch, arbPush, arbPreid, async (semver, branch, push, preid) => {
        const plan = makePlan(semver, branch, push, preid);

        // Shared pipeline mock that always returns the same plan for dryRun: true
        const runPipelineMock = jest.fn().mockImplementation((opts: PipelineOpts) => {
          expect(opts.dryRun).toBe(true);
          return Promise.resolve(plan);
        });

        const reporter = createReporter({ json: false });

        // --- Run plan command ---
        const planStdout = new PassThrough();
        const planDeps: PlanCommandDeps = {
          runPipeline: runPipelineMock,
          pipelineDeps: {} as PipelineDeps,
          reporter,
          stdout: planStdout,
        };

        const planResult = await runPlanCommand(
          { semver, branch, push, preid, json: false },
          planDeps,
        );
        planStdout.destroy();

        // --- Run release --dry-run ---
        const releaseStdout = new PassThrough();
        const releaseDeps: ReleaseCommandDeps = {
          runPipeline: runPipelineMock,
          pipelineDeps: {} as PipelineDeps,
          interactionManager: makeMockInteraction(),
          operationLog: makeMockOperationLog(),
          reporter,
          stdout: releaseStdout,
        };

        const releaseResult = await runReleaseCommand(
          {
            semver,
            branch,
            push,
            preid,
            dryRun: true,
            json: false,
            verbose: false,
          },
          releaseDeps,
        );
        releaseStdout.destroy();

        // Both should return the exact same plan
        expect(planResult).toEqual(releaseResult);
        expect((planResult as DryRunPlan).dryRun).toBe(true);
        expect((releaseResult as DryRunPlan).dryRun).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Backward compatibility routing
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 9.3, 12.2**
 *
 * For any valid --semver and --branch values, calling without a subcommand
 * (i.e. preprocessArgv(['--semver=X', '--branch=Y', ...]))
 * SHALL produce an argv array whose first element is 'release',
 * effectively routing to Release_Command.
 */
describe('Property 10: Backward compatibility routing', () => {
  test('preprocessArgv prepends "release" for any --semver + --branch without subcommand', () => {
    fc.assert(
      fc.property(arbSemver, arbBranch, arbPush, (semver, branch, push) => {
        const args = [`--semver=${semver}`, `--branch=${branch}`];
        if (push) args.push('--push');

        const result = preprocessArgv(args);

        // First element must be 'release'
        expect(result[0]).toBe('release');
        // Original args must be preserved after 'release'
        expect(result.slice(1)).toEqual(args);
        // Length must be original + 1
        expect(result.length).toBe(args.length + 1);
      }),
      { numRuns: 100 },
    );
  });

  test('preprocessArgv is idempotent when subcommand is already present', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUBCOMMANDS),
        arbSemver,
        arbBranch,
        (cmd, semver, branch) => {
          // For commands that accept --semver/--branch
          const args = [cmd, `--semver=${semver}`, `--branch=${branch}`];
          const result = preprocessArgv(args);

          // Should not prepend anything — subcommand already present
          expect(result).toEqual(args);
          expect(result[0]).toBe(cmd);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('preprocessArgv does NOT prepend "release" when only --semver is present (no --branch)', () => {
    fc.assert(
      fc.property(arbSemver, (semver) => {
        const args = [`--semver=${semver}`, '--json'];
        const result = preprocessArgv(args);

        // Should NOT prepend release — --branch is missing
        expect(result).toEqual(args);
        expect(result[0]).not.toBe('release');
      }),
      { numRuns: 100 },
    );
  });

  test('preprocessArgv does NOT prepend "release" when only --branch is present (no --semver)', () => {
    fc.assert(
      fc.property(arbBranch, (branch) => {
        const args = [`--branch=${branch}`, '--verbose'];
        const result = preprocessArgv(args);

        // Should NOT prepend release — --semver is missing
        expect(result).toEqual(args);
        expect(result[0]).not.toBe('release');
      }),
      { numRuns: 100 },
    );
  });
});
