// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import { EXIT_CODES, VersioningsError } from './errors';
import { Executor } from './executor';

export interface CheckUniquenessOpts {
  tagName: string;
  branchName: string | null;
  push: boolean;
  remote?: string;
  skipBranchCheck?: boolean;
}

export interface ArtifactChecker {
  checkUniqueness(opts: CheckUniquenessOpts): Promise<void>;
}

/**
 * @param executor — executor instance with run(cmd) method
 * @returns { checkUniqueness(opts): Promise<void> }
 */
export function createArtifactChecker(executor: Executor): ArtifactChecker {
  return {
    async checkUniqueness({ tagName, branchName, push, remote, skipBranchCheck }: CheckUniquenessOpts): Promise<void> {
      const remoteName = remote || 'origin';
      const shouldCheckBranch = branchName !== null && skipBranchCheck !== true;

      // 1. Check local tags — exact match
      const tagResult = await executor.run('git tag --list');
      for (const line of tagResult.lines) {
        if (line === tagName) {
          throw new VersioningsError(
            EXIT_CODES.ARTIFACT_CONFLICT,
            `Tag already exists: ${tagName}`,
            { type: 'tag', name: tagName, scope: 'local' }
          );
        }
      }

      // 2. Check local branches — strip leading "* " and whitespace, exact match
      if (shouldCheckBranch) {
        const branchResult = await executor.run('git branch --list');
        const localBranches = branchResult.stdout
          .split(/\r?\n/)
          .map(function (line: string) { return line.replace(/^\*?\s*/, ''); })
          .filter(Boolean);

        for (const name of localBranches) {
          if (name === branchName) {
            throw new VersioningsError(
              EXIT_CODES.ARTIFACT_CONFLICT,
              `Branch already exists: ${branchName}`,
              { type: 'branch', name: branchName, scope: 'local' }
            );
          }
        }
      }

      // 3–4. Check remote artifacts only when push is true
      if (push === true) {
        // 3. Remote tags
        const remoteTagResult = await executor.run(
          'git ls-remote --tags ' + remoteName
        );
        const remoteTagLines = remoteTagResult.stdout.split(/\r?\n/).filter(Boolean);
        for (const line of remoteTagLines) {
          const match = line.match(/\trefs\/tags\/(.+)$/);
          if (!match) continue;
          const refName = match[1];
          if (refName.endsWith('^{}')) continue;
          if (refName === tagName) {
            throw new VersioningsError(
              EXIT_CODES.ARTIFACT_CONFLICT,
              `Tag already exists on remote: ${tagName}`,
              { type: 'tag', name: tagName, scope: 'remote' }
            );
          }
        }

        // 4. Remote branches
        if (shouldCheckBranch) {
          const remoteHeadResult = await executor.run(
            'git ls-remote --heads ' + remoteName
          );
          const remoteHeadLines = remoteHeadResult.stdout.split(/\r?\n/).filter(Boolean);
          for (const line of remoteHeadLines) {
            const match = line.match(/\trefs\/heads\/(.+)$/);
            if (!match) continue;
            if (match[1] === branchName) {
              throw new VersioningsError(
                EXIT_CODES.ARTIFACT_CONFLICT,
                `Branch already exists on remote: ${branchName}`,
                { type: 'branch', name: branchName, scope: 'remote' }
              );
            }
          }
        }
      }
    },
  };
}
