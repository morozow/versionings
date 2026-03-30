// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as path from 'path';
import { loadAndValidateConfig } from './config.validator';
import { createExecutor } from './executor';
import { createRollbackManager } from './rollback';
import { createArtifactChecker } from './artifact.checker';
import { createReporter } from './reporter';
import { runPipeline } from './pipeline';
import { EXIT_CODES, VersioningsError } from './errors';
import type { PipelineResult, DryRunPlan } from './reporter';

// Parse CLI arguments
const args = require('yargs')
  .option('semver', { type: 'string', demandOption: true })
  .option('branch', { type: 'string', demandOption: true })
  .option('push', { type: 'boolean', default: false })
  .option('preid', { type: 'string' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('json', { type: 'boolean', default: false })
  .option('verbose', { type: 'boolean', default: false })
  .argv;

async function main(): Promise<void> {
  // 1. Check Node.js version
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error(`Node.js >= 18 required. Current: ${process.version}`);
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }

  // 2. Load and validate config
  const config = loadAndValidateConfig(path.join(process.cwd(), 'version.json'));

  // 3. Create dependencies via DI
  const executor = createExecutor({ verbose: args.verbose });
  const rollbackManager = createRollbackManager(executor);
  const artifactChecker = createArtifactChecker(executor);
  const reporter = createReporter({ json: args.json });

  // 4. Run pipeline
  const result = await runPipeline(
    {
      semver: args.semver,
      branch: args.branch,
      push: args.push,
      preid: args.preid,
      dryRun: args['dry-run'],
      json: args.json,
      verbose: args.verbose,
    },
    { executor, config, rollbackManager, artifactChecker },
  );

  // 5. Output result via reporter
  if ('dryRun' in result && result.dryRun) {
    process.stdout.write(reporter.reportDryRun(result as DryRunPlan));
  } else {
    process.stdout.write(reporter.reportSuccess(result as PipelineResult));
    if ((result as PipelineResult).pullRequestUrl && !args.json) {
      const open = require('open');
      await open((result as PipelineResult).pullRequestUrl);
    }
  }

  // 6. Exit with success
  process.exit(EXIT_CODES.SUCCESS);
}

main().catch(async (err: any) => {
  const reporter = createReporter({ json: args?.json ?? false });
  if (err instanceof VersioningsError) {
    process.stderr.write(reporter.reportError(err));
    process.exit(err.code);
  }
  console.error(err);
  process.exit(EXIT_CODES.COMMAND_FAILED);
});
