import { evaluationRetryScoresRunner, evaluationRunner } from './evaluation-runner.service.js';
import { enqueueGraphileJob } from './graphile-queue.service.js';

const QUEUE_DRIVER = (process.env.EVALUATION_QUEUE_DRIVER || 'memory').toLowerCase();

export async function enqueueEvaluationRun(userId: string, runId: string): Promise<void> {
  if (QUEUE_DRIVER === 'pg') {
    await enqueueGraphileJob(
      'evaluation.run',
      { runId },
      {
        maxAttempts: 1,
        jobKey: `evaluation.run:${runId}`,
        jobKeyMode: 'replace',
      }
    );
    return;
  }

  await evaluationRunner.enqueue(userId, runId);
}

export async function enqueueEvaluationRetryScores(userId: string, runId: string): Promise<void> {
  if (QUEUE_DRIVER === 'pg') {
    await enqueueGraphileJob(
      'evaluation.retry_scores',
      { runId },
      {
        maxAttempts: 1,
        jobKey: `evaluation.retry_scores:${runId}`,
        jobKeyMode: 'replace',
      }
    );
    return;
  }

  await evaluationRetryScoresRunner.enqueue(userId, runId);
}

export function abortEvaluationRun(runId: string): void {
  if (QUEUE_DRIVER === 'pg') return;
  evaluationRunner.abort(runId);
}

export function abortEvaluationRetryScores(runId: string): void {
  if (QUEUE_DRIVER === 'pg') return;
  evaluationRetryScoresRunner.abort(runId);
}

export function getEvaluationQueueDriver(): string {
  return QUEUE_DRIVER;
}
