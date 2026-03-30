// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau
const esbuild = require('esbuild');
esbuild.buildSync({
  entryPoints: ['version.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outdir: 'dist',
  banner: { js: '#!/usr/bin/env node' },
  external: ['yargs', 'open'],
});
