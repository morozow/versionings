// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

import * as os from 'os';

export interface ActorMetadata {
  gitUserName: string;
  gitUserEmail: string;
  hostname: string;
  ciActor: string | null;
}

export interface ActorResolverDeps {
  executor: { run(cmd: string): Promise<{ stdout: string }> };
  env: Record<string, string | undefined>;
  hostname?: string;
}

/**
 * Detect whether the current environment is a CI system.
 * Checks indicator env vars for GitHub Actions, GitLab CI, Azure DevOps,
 * Bitbucket Pipelines, and the generic CI variable.
 */
export function detectCI(env: Record<string, string | undefined>): boolean {
  return (
    env.GITHUB_ACTIONS === 'true' ||
    env.GITLAB_CI === 'true' ||
    env.TF_BUILD === 'True' ||
    env.BITBUCKET_BUILD_NUMBER !== undefined ||
    env.CI === 'true'
  );
}

/**
 * Extract the CI actor from environment variables.
 * Returns the value of the first matching CI actor variable, or null.
 */
export function resolveCIActor(env: Record<string, string | undefined>): string | null {
  if (env.GITHUB_ACTOR !== undefined) return env.GITHUB_ACTOR;
  if (env.GITLAB_USER_LOGIN !== undefined) return env.GITLAB_USER_LOGIN;
  if (env.BUILD_REQUESTEDFOR !== undefined) return env.BUILD_REQUESTEDFOR;
  if (env.BITBUCKET_STEP_TRIGGERER_UUID !== undefined) return env.BITBUCKET_STEP_TRIGGERER_UUID;
  return null;
}


/**
 * Resolve actor metadata by collecting git user info, hostname, and CI actor.
 * All fields gracefully fall back to defaults on error.
 */
export async function resolveActorMetadata(deps: ActorResolverDeps): Promise<ActorMetadata> {
  let gitUserName = 'unknown';
  let gitUserEmail = 'unknown';

  try {
    const result = await deps.executor.run('git config user.name');
    if (result.stdout) {
      gitUserName = result.stdout;
    }
  } catch {
    // fallback to 'unknown'
  }

  try {
    const result = await deps.executor.run('git config user.email');
    if (result.stdout) {
      gitUserEmail = result.stdout;
    }
  } catch {
    // fallback to 'unknown'
  }

  let hostname: string;
  if (deps.hostname !== undefined) {
    hostname = deps.hostname;
  } else {
    try {
      hostname = os.hostname();
    } catch {
      hostname = 'unknown';
    }
  }

  const ciActor = resolveCIActor(deps.env);

  return { gitUserName, gitUserEmail, hostname, ciActor };
}
