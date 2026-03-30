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
