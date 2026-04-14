// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

/**
 * Backward-compatibility shim.
 * Delegates to esbuild.config.mjs (the production build configuration).
 *
 * All E2E tests call `node build.js` in beforeAll — this shim ensures
 * they continue to work without modification.
 */
const { execSync } = require('child_process');

execSync(`${process.execPath} esbuild.config.mjs`, {
  cwd: __dirname,
  stdio: 'inherit',
});
