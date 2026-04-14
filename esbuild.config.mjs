// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * versionings — esbuild build configuration
 *
 * Single bundled CJS output for the CLI binary.
 *
 * Entry: src/cli/version.ts → dist/version.js
 * All internal modules bundled. External deps resolved at runtime.
 */

import { build } from 'esbuild';
import { builtinModules } from 'node:module';

// ─── Externals ──────────────────────────────────────────────────

const nodeBuiltins = builtinModules.flatMap(m => [m, `node:${m}`]);

const runtimeExternals = [
  'yargs',
  'open',
  'js-yaml',
  'ajv',
];

const external = [...nodeBuiltins, ...runtimeExternals];

// ─── Build targets ──────────────────────────────────────────────

const targets = {
  cli: {
    label: 'CLI Bundle',
    entryPoints: ['src/cli/version.ts'],
    outfile: 'out/dist/version.js',
    bundle: true,
    platform: 'node',
    target: ['node18'],
    format: 'cjs',
    treeShaking: true,
    minify: true,
    sourcemap: false,
    external,
    banner: { js: '#!/usr/bin/env node' },
    logLevel: 'info',
  },
};

// ─── Runner ─────────────────────────────────────────────────────

const targetFilter = process.argv[2];

for (const [name, config] of Object.entries(targets)) {
  if (targetFilter && name !== targetFilter) continue;

  const { label, ...buildConfig } = config;
  const startMs = Date.now();

  await build(buildConfig);

  const elapsed = Date.now() - startMs;
  console.log(`  ✓ ${label ?? name} → ${buildConfig.outfile ?? buildConfig.outdir} (${elapsed}ms)`);
}

console.log('\nesbuild: build complete');
