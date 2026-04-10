// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as path from 'path';
import { loadConfig } from './config.loader';
import { loadAndValidateConfig } from './config.validator';
import { createExecutor } from './executor';
import { createRollbackManager } from './rollback';
import { createArtifactChecker } from './artifact.checker';
import { createReporter } from './reporter';
import { runPipeline } from './pipeline';
import { createInteractionManager } from './interaction.manager';
import { createOperationLog } from './operation.log';
import { runInitCommand } from './init.command';
import { runValidateCommand } from './validate.command';
import { runPlanCommand } from './plan.command';
import { runReleaseCommand } from './release.command';
import { runRollbackCommand } from './rollback.command';
import { runDoctorCommand } from './doctor.command';
import { runChangelogCommand } from './changelog.command';
import { analyzeBump, DEFAULT_BUMP_POLICY } from './commit.analyzer';
import type { BumpPolicy } from './commit.analyzer';
import { generateChangelog, DEFAULT_GROUP_TITLES } from './changelog.generator';
import type { ChangelogOpts } from './changelog.generator';
import { SUBCOMMANDS, preprocessArgv, buildCli } from './command.router';
import { EXIT_CODES, VersioningsError } from './errors';
import { resolveAuth, maskToken } from './auth.resolver';
import { createSCMRegistry } from './scm.registry';
import { createHttpClient } from './http.client';
import { createUrlParser } from './url.parser';
import { createGitHubProvider } from './github.provider';
import { createGitLabProvider } from './gitlab.provider';
import { createBitbucketCloudProvider, createBitbucketServerProvider } from './bitbucket.provider';
import { createAzureDevOpsProvider } from './azure.provider';
import { createStrategyRegistry } from './strategy.registry';
import { checkPolicy } from './policy.checker';
import type { PrCreatorDeps } from './pr.creator';
import type { PipelineResult, DryRunPlan } from './reporter';

// ---------------------------------------------------------------------------
// --print-config handler
// ---------------------------------------------------------------------------

async function handlePrintConfig(args: any): Promise<boolean> {
  if (!args['print-config']) return false;

  const cwd = process.cwd();
  const env = process.env as Record<string, string | undefined>;
  const reporter = createReporter({ json: args.json });

  const loadResult = loadConfig({
    cwd,
    env,
    strict: args.strict,
  });

  // Print warnings to stderr
  for (const w of loadResult.warnings) {
    process.stderr.write(w + '\n');
  }

  // Mask token values in provenance before printing
  const provenance = loadResult.provenance;
  for (const key of Object.keys(provenance)) {
    if (key === 'git.auth.token' && typeof provenance[key].value === 'string' && provenance[key].value) {
      provenance[key] = { ...provenance[key], value: maskToken(provenance[key].value as string) };
    }
  }

  const output = reporter.reportProvenance(provenance);
  process.stdout.write(output + '\n');
  process.exit(EXIT_CODES.SUCCESS);
  return true; // unreachable, but satisfies TS
}

// ---------------------------------------------------------------------------
// PR Creator dependency builder
// ---------------------------------------------------------------------------

function buildPrCreatorDeps(): PrCreatorDeps {
  const registry = createSCMRegistry();
  registry.register('github', createGitHubProvider);
  registry.register('github-enterprise', createGitHubProvider);
  registry.register('bitbucket', createBitbucketCloudProvider);
  registry.register('bitbucket-server', createBitbucketServerProvider);
  registry.register('gitlab', createGitLabProvider);
  registry.register('azure-devops', createAzureDevOpsProvider);

  return {
    registry,
    httpClient: createHttpClient(),
    urlParser: createUrlParser(),
    resolveAuth,
    env: process.env as Record<string, string | undefined>,
  };
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleInit(args: any): Promise<void> {
  const interactionManager = createInteractionManager(
    {
      ci: args.ci,
      nonInteractive: args['non-interactive'],
      yes: args.yes,
      isTTY: Boolean(process.stdout.isTTY),
    },
    process.stdin,
    process.stdout,
  );

  const executor = createExecutor({ verbose: args.verbose });

  await runInitCommand(
    { format: args.format },
    {
      interactionManager,
      executor,
      cwd: process.cwd(),
      stdin: process.stdin,
      stdout: process.stdout,
    },
  );
}

async function handleValidate(args: any): Promise<void> {
  const cwd = process.cwd();
  const env = process.env as Record<string, string | undefined>;
  const executor = createExecutor({ verbose: args.verbose });
  const reporter = createReporter({ json: args.json });

  const result = await runValidateCommand(
    { json: args.json, strict: args.strict },
    {
      configLoader: loadConfig,
      executor,
      reporter,
      cwd,
      env,
      stdout: process.stdout,
    },
  );

  if (!result.valid) {
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }
}

async function handlePlan(args: any): Promise<void> {
  const cwd = process.cwd();
  const env = process.env as Record<string, string | undefined>;

  // Load config via new loader for warnings/provenance
  const configResult = loadConfig({ cwd, env, strict: args.strict });
  for (const w of configResult.warnings) {
    process.stderr.write(w + '\n');
  }

  // Load full config via legacy loader for pipeline compatibility
  // (pipeline needs config.common.messages and config.package.semver)
  const config = loadAndValidateConfig(path.join(cwd, 'version.json'));

  const executor = createExecutor({ verbose: args.verbose });
  const rollbackManager = createRollbackManager(executor);
  const artifactChecker = createArtifactChecker(executor);
  const reporter = createReporter({ json: args.json });

  await runPlanCommand(
    {
      semver: args.semver,
      branch: args.branch,
      push: args.push,
      preid: args.preid,
      json: args.json,
      prMode: args['pr-mode'],
      noPr: args['no-pr'],
    },
    {
      runPipeline,
      pipelineDeps: {
        executor,
        config,
        rollbackManager,
        artifactChecker,
        prCreator: buildPrCreatorDeps(),
        strategyRegistry: createStrategyRegistry(),
        policyChecker: checkPolicy,
        ...(args.semver === 'auto' ? {
          commitAnalyzer: resolveCommitAnalyzerDeps(config),
          changelogGenerator: resolveChangelogGeneratorDeps(config),
        } : {}),
      },
      reporter,
      stdout: process.stdout,
    },
  );
}

async function handleRelease(args: any): Promise<void> {
  const cwd = process.cwd();
  const env = process.env as Record<string, string | undefined>;

  // Load config via new loader for warnings/provenance
  const configResult = loadConfig({ cwd, env, strict: args.strict });
  for (const w of configResult.warnings) {
    process.stderr.write(w + '\n');
  }

  // Load full config via legacy loader for pipeline compatibility
  // (pipeline needs config.common.messages and config.package.semver)
  const config = loadAndValidateConfig(path.join(cwd, 'version.json'));

  const executor = createExecutor({ verbose: args.verbose });
  const rollbackManager = createRollbackManager(executor);
  const artifactChecker = createArtifactChecker(executor);
  const reporter = createReporter({ json: args.json });

  const interactionManager = createInteractionManager(
    {
      ci: args.ci,
      nonInteractive: args['non-interactive'],
      yes: args.yes,
      isTTY: Boolean(process.stdout.isTTY),
    },
    process.stdin,
    process.stdout,
  );

  const operationLog = createOperationLog(
    path.join(cwd, '.versionings', 'operations'),
  );

  const result = await runReleaseCommand(
    {
      semver: args.semver,
      branch: args.branch,
      push: args.push,
      preid: args.preid,
      dryRun: args['dry-run'],
      json: args.json,
      verbose: args.verbose,
      prMode: args['pr-mode'],
      noPr: args['no-pr'],
    },
    {
      runPipeline,
      pipelineDeps: {
        executor,
        config,
        rollbackManager,
        artifactChecker,
        prCreator: buildPrCreatorDeps(),
        strategyRegistry: createStrategyRegistry(),
        policyChecker: checkPolicy,
        ...(args.semver === 'auto' ? {
          commitAnalyzer: resolveCommitAnalyzerDeps(config),
          changelogGenerator: resolveChangelogGeneratorDeps(config),
        } : {}),
      },
      interactionManager,
      operationLog,
      reporter,
      stdout: process.stdout,
    },
  );

  // Open PR URL in browser: only for fallback status (PR not yet created via API)
  if (!args.json && !args['dry-run']) {
    const pipelineResult = result as PipelineResult;
    if (pipelineResult.pullRequest) {
      // status === 'fallback' → open in browser (user needs to create PR manually)
      // status === 'created' → PR already created via API, don't open browser
      if (pipelineResult.pullRequest.status === 'fallback' && pipelineResult.pullRequest.url) {
        try {
          const open = require('open');
          await open(pipelineResult.pullRequest.url);
        } catch (_) {
          // Best-effort: don't fail if browser can't open
        }
      }
    } else if (pipelineResult.pullRequestUrl) {
      // Backward compatibility: no pullRequest object, just pullRequestUrl
      try {
        const open = require('open');
        await open(pipelineResult.pullRequestUrl);
      } catch (_) {
        // Best-effort: don't fail if browser can't open
      }
    }
  }
}

async function handleRollback(args: any): Promise<void> {
  const cwd = process.cwd();
  const executor = createExecutor({ verbose: args.verbose });
  const reporter = createReporter({ json: args.json });

  const interactionManager = createInteractionManager(
    {
      ci: args.ci,
      nonInteractive: args['non-interactive'],
      yes: args.yes,
      isTTY: Boolean(process.stdout.isTTY),
    },
    process.stdin,
    process.stdout,
  );

  const operationLog = createOperationLog(
    path.join(cwd, '.versionings', 'operations'),
  );

  await runRollbackCommand(
    {
      from: args.from,
      json: args.json,
      ci: args.ci,
      yes: args.yes,
    },
    {
      operationLog,
      executor,
      createRollbackManager: (exec) => createRollbackManager(exec),
      interactionManager,
      reporter,
      stdout: process.stdout,
    },
  );
}

async function handleDoctor(args: any): Promise<void> {
  const cwd = process.cwd();
  const env = process.env as Record<string, string | undefined>;
  const executor = createExecutor({ verbose: args.verbose });
  const reporter = createReporter({ json: args.json });

  const checks = await runDoctorCommand(
    { json: args.json },
    {
      configLoader: loadConfig,
      executor,
      reporter,
      cwd,
      env,
      stdout: process.stdout,
    },
  );

  const hasFail = checks.some((c) => c.status === 'fail');
  if (hasFail) {
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Config helpers for Version Intelligence
// ---------------------------------------------------------------------------

function resolveCommitAnalyzerDeps(config: any) {
  const cc = config.conventionalCommits ?? { enabled: true, types: DEFAULT_BUMP_POLICY, fallbackBump: null };
  const bumpPolicy: BumpPolicy = cc.types ?? DEFAULT_BUMP_POLICY;
  const fallbackBump: 'major' | 'minor' | 'patch' | null = cc.fallbackBump ?? null;
  return { analyzeBump, bumpPolicy, fallbackBump };
}

function resolveChangelogGeneratorDeps(config: any) {
  const cl = config.changelog ?? { groupTitles: DEFAULT_GROUP_TITLES, excludeTypes: [], includeNonConventional: false };
  const cc = config.conventionalCommits ?? { types: DEFAULT_BUMP_POLICY };
  const bumpPolicy: BumpPolicy = cc.types ?? DEFAULT_BUMP_POLICY;

  const changelogConfig: ChangelogOpts = {
    version: null,
    date: new Date().toISOString().slice(0, 10),
    format: 'markdown',
    groupTitles: cl.groupTitles ?? DEFAULT_GROUP_TITLES,
    excludeTypes: cl.excludeTypes ?? [],
    includeNonConventional: cl.includeNonConventional ?? false,
    bumpPolicy,
  };

  return {
    generateChangelog,
    changelogConfig,
    changelogFile: cl.file,
  };
}

// ---------------------------------------------------------------------------
// Changelog handler
// ---------------------------------------------------------------------------

async function handleChangelog(args: any): Promise<void> {
  const cwd = process.cwd();
  const config = loadAndValidateConfig(path.join(cwd, 'version.json'));
  const executor = createExecutor({ verbose: args.verbose });

  const cc = config.conventionalCommits ?? { types: DEFAULT_BUMP_POLICY };
  const cl = config.changelog ?? { groupTitles: DEFAULT_GROUP_TITLES, excludeTypes: [], includeNonConventional: false };
  const bumpPolicy: BumpPolicy = (cc.types ?? DEFAULT_BUMP_POLICY) as BumpPolicy;

  await runChangelogCommand(
    {
      from: args.from,
      to: args.to,
      output: args.output,
      format: args.format,
      json: args.json,
    },
    {
      executor,
      bumpPolicy,
      changelogConfig: {
        groupTitles: cl.groupTitles ?? DEFAULT_GROUP_TITLES,
        excludeTypes: cl.excludeTypes ?? [],
        includeNonConventional: cl.includeNonConventional ?? false,
      },
      stdout: process.stdout,
    },
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Check Node.js version
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error(`Node.js >= 18 required. Current: ${process.version}`);
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }

  // 2. Preprocess argv for backward compatibility
  const rawArgv = process.argv.slice(2);
  const processedArgv = preprocessArgv(rawArgv);

  // 3. Parse with yargs
  const cli = buildCli(processedArgv);
  const args = cli.parse();

  // 4. Handle --print-config (global, runs before any subcommand)
  await handlePrintConfig(args);

  // 5. Determine which command to run
  const command = args._[0] as string | undefined;

  if (!command) {
    // No subcommand and no --semver/--branch (those would have been
    // preprocessed into 'release') → show help
    cli.showHelp();
    return;
  }

  // 6. Route to subcommand handler
  switch (command) {
    case 'init':
      await handleInit(args);
      break;
    case 'validate':
      await handleValidate(args);
      break;
    case 'plan':
      await handlePlan(args);
      break;
    case 'release':
      await handleRelease(args);
      break;
    case 'rollback':
      await handleRollback(args);
      break;
    case 'doctor':
      await handleDoctor(args);
      break;
    case 'changelog':
      await handleChangelog(args);
      break;
    default: {
      // Should not reach here due to strictCommands, but just in case
      const availableList = SUBCOMMANDS.map((c) => `  ${c}`).join('\n');
      throw new VersioningsError(
        EXIT_CODES.INVALID_ARGS,
        `Unknown command: ${command}\n\nAvailable commands:\n${availableList}`,
      );
    }
  }

  process.exit(EXIT_CODES.SUCCESS);
}

main().catch(async (err: any) => {
  const reporter = createReporter({ json: false });
  try {
    // Try to detect --json from argv for error formatting
    const hasJson = process.argv.includes('--json');
    if (hasJson) {
      const jsonReporter = createReporter({ json: true });
      if (err instanceof VersioningsError) {
        process.stderr.write(jsonReporter.reportError(err));
        process.exit(err.code);
      }
    }
  } catch (_) {
    // Fall through to default handling
  }

  if (err instanceof VersioningsError) {
    process.stderr.write(reporter.reportError(err));
    process.exit(err.code);
  }
  console.error(err);
  process.exit(EXIT_CODES.COMMAND_FAILED);
});
