/* Versioning automation tool, 2018-present */

const STEP_TYPES = Object.freeze({
  NPM_VERSION_BUMP: 'npm_version_bump',
  BRANCH_CREATED: 'branch_created',
  TAG_CREATED: 'tag_created',
  COMMITTED: 'committed',
  PUSHED: 'pushed',
});

/**
 * @param {Object} executor — executor instance with run(cmd) method
 * @returns {Object} — { record(step), rollback(): Promise<RollbackResult> }
 */
function createRollbackManager(executor) {
  const steps = [];

  function record(step) {
    steps.push(step);
  }

  async function rollback() {
    const failedSteps = [];

    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      try {
        await rollbackStep(step);
      } catch (error) {
        failedSteps.push({ step, error });
      }
    }

    return {
      success: failedSteps.length === 0,
      failedSteps,
    };
  }

  async function rollbackStep(step) {
    const { type, meta } = step;

    switch (type) {
      case STEP_TYPES.NPM_VERSION_BUMP:
        await executor.run('git reset --hard');
        break;

      case STEP_TYPES.BRANCH_CREATED:
        await executor.run(`git branch -D ${meta.name}`);
        break;

      case STEP_TYPES.TAG_CREATED:
        await executor.run(`git tag -d ${meta.name}`);
        break;

      case STEP_TYPES.COMMITTED:
        await executor.run('git reset --hard HEAD~1');
        break;

      case STEP_TYPES.PUSHED: {
        const remote = meta.remote || 'origin';
        const errors = [];

        try {
          await executor.run(`git push ${remote} --delete ${meta.branch}`);
        } catch (err) {
          errors.push(err);
        }

        if (meta.tag) {
          try {
            await executor.run(`git push ${remote} --delete ${meta.tag}`);
          } catch (err) {
            errors.push(err);
          }
        }

        if (errors.length > 0) {
          const combined = new Error(
            `Failed to rollback pushed artifacts: ${errors.map(e => e.message).join('; ')}`
          );
          combined.errors = errors;
          throw combined;
        }
        break;
      }

      default:
        throw new Error(`Unknown step type: ${type}`);
    }
  }

  return { record, rollback };
}

module.exports = { createRollbackManager, STEP_TYPES };
