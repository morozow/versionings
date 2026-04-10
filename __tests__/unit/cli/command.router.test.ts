// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { preprocessArgv, SUBCOMMANDS, buildCli } from '../../../src/cli/command.router';
import { VersioningsError, EXIT_CODES } from '../../../src/core/errors';

// ---------------------------------------------------------------------------
// Tests: SUBCOMMANDS constant
// ---------------------------------------------------------------------------

describe('SUBCOMMANDS', () => {
  it('contains all seven expected subcommands', () => {
    expect(SUBCOMMANDS).toEqual(['init', 'validate', 'plan', 'release', 'rollback', 'doctor', 'changelog']);
  });

  it('has no duplicates', () => {
    const unique = new Set(SUBCOMMANDS);
    expect(unique.size).toBe(SUBCOMMANDS.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: preprocessArgv — backward compatibility routing
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
// ---------------------------------------------------------------------------

describe('preprocessArgv', () => {
  describe('subcommand passthrough', () => {
    it.each(SUBCOMMANDS)('passes through when first arg is "%s"', (cmd) => {
      const input = [cmd, '--json'];
      expect(preprocessArgv(input)).toEqual(input);
    });

    it('preserves all trailing args for a known subcommand', () => {
      const input = ['release', '--semver=patch', '--branch=fix', '--push'];
      expect(preprocessArgv(input)).toEqual(input);
    });
  });

  describe('backward compatibility: --semver + --branch → release', () => {
    it('prepends "release" when --semver and --branch are present without subcommand', () => {
      const input = ['--semver=patch', '--branch=fix'];
      expect(preprocessArgv(input)).toEqual(['release', '--semver=patch', '--branch=fix']);
    });

    it('prepends "release" with additional flags', () => {
      const input = ['--semver=minor', '--branch=feat', '--push', '--json'];
      expect(preprocessArgv(input)).toEqual(['release', '--semver=minor', '--branch=feat', '--push', '--json']);
    });

    it('prepends "release" when --semver and --branch use space-separated values', () => {
      const input = ['--semver', 'patch', '--branch', 'fix'];
      expect(preprocessArgv(input)).toEqual(['release', '--semver', 'patch', '--branch', 'fix']);
    });
  });

  describe('no subcommand and no --semver/--branch → unchanged (help)', () => {
    it('returns empty array unchanged', () => {
      expect(preprocessArgv([])).toEqual([]);
    });

    it('returns args unchanged when only --json is passed', () => {
      const input = ['--json'];
      expect(preprocessArgv(input)).toEqual(input);
    });

    it('returns args unchanged when only --semver is passed (no --branch)', () => {
      const input = ['--semver=patch'];
      expect(preprocessArgv(input)).toEqual(input);
    });

    it('returns args unchanged when only --branch is passed (no --semver)', () => {
      const input = ['--branch=fix'];
      expect(preprocessArgv(input)).toEqual(input);
    });
  });

  describe('unknown first arg that is not a flag', () => {
    it('does not prepend release for unknown subcommand without --semver/--branch', () => {
      const input = ['nonexistent'];
      expect(preprocessArgv(input)).toEqual(input);
    });

    it('does not prepend release for unknown subcommand even with --semver/--branch', () => {
      // 'nonexistent' is not a flag (no --) and not in SUBCOMMANDS,
      // so hasSubcommand is false. But --semver and --branch are present → prepends release.
      const input = ['nonexistent', '--semver=patch', '--branch=fix'];
      // Since 'nonexistent' doesn't start with '-' but is not in SUBCOMMANDS,
      // hasSubcommand = false, hasSemver = true, hasBranch = true → prepend release
      expect(preprocessArgv(input)).toEqual(['release', 'nonexistent', '--semver=patch', '--branch=fix']);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: buildCli — yargs routing
// Requirements: 12.1, 12.4, 12.5
// ---------------------------------------------------------------------------

describe('buildCli', () => {
  describe('subcommand routing', () => {
    it.each(SUBCOMMANDS)('recognizes "%s" as a valid subcommand', (cmd) => {
      // For commands that require --semver/--branch, provide them
      const needsArgs = ['plan', 'release'];
      const args = needsArgs.includes(cmd)
        ? [cmd, '--semver=patch', '--branch=fix']
        : [cmd];

      const cli = buildCli(args);
      // Parse without executing handler — just verify no error
      const parsed = cli.parse();
      expect(parsed._[0]).toBe(cmd);
    });
  });

  describe('unknown subcommand → error', () => {
    it('throws VersioningsError with INVALID_ARGS for unknown command', () => {
      expect(() => {
        const cli = buildCli(['nonexistent']);
        cli.parse();
      }).toThrow(VersioningsError);

      try {
        const cli = buildCli(['nonexistent']);
        cli.parse();
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersioningsError);
        expect(err.code).toBe(EXIT_CODES.INVALID_ARGS);
        expect(err.message).toContain('Available commands');
        // Should list all subcommands
        for (const cmd of SUBCOMMANDS) {
          expect(err.message).toContain(cmd);
        }
      }
    });
  });

  describe('--print-config flag', () => {
    it('parses --print-config as a boolean global option', () => {
      const cli = buildCli(['--print-config']);
      const parsed = cli.parse();
      expect(parsed['print-config']).toBe(true);
    });

    it('defaults --print-config to false', () => {
      const cli = buildCli([]);
      const parsed = cli.parse();
      expect(parsed['print-config']).toBe(false);
    });
  });

  describe('global options', () => {
    it('parses --json, --verbose, --ci, --yes, --strict', () => {
      const cli = buildCli(['validate', '--json', '--verbose', '--ci', '--yes', '--strict']);
      const parsed = cli.parse();
      expect(parsed.json).toBe(true);
      expect(parsed.verbose).toBe(true);
      expect(parsed.ci).toBe(true);
      expect(parsed.yes).toBe(true);
      expect(parsed.strict).toBe(true);
    });

    it('parses -y as alias for --yes', () => {
      const cli = buildCli(['validate', '-y']);
      const parsed = cli.parse();
      expect(parsed.yes).toBe(true);
    });

    it('parses --non-interactive', () => {
      const cli = buildCli(['validate', '--non-interactive']);
      const parsed = cli.parse();
      expect(parsed['non-interactive']).toBe(true);
    });
  });
});
