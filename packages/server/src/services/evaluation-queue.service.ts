import { makeWorkerUtils, type WorkerUtils } from 'graphile-worker';
import { env } from '../config/env.js';
import { evaluationRetryScoresRunner, evaluationRunner } from './evaluation-runner.service.js';

const QUEUE_DRIVER = (process.env.EVALUATION_QUEUE_DRIVER || 'memory').toLowerCase();

let workerUtilsPromise: Promise<WorkerUtils> | null = null;

async function getWorkerUtils(): Promise<WorkerUtils> {
  if (!workerUtilsPromise) {
    workerUtilsPromise = makeWorkerUtils({ connectionString: env.DATABASE_URL });
  }
  return workerUtilsPromise;
}

export async function enqueueEvaluationRun(userId: string, runId: string): Promise<void> {
  if (QUEUE_DRIVER === 'pg') {
    const utils = await getWorkerUtils();
    await utils.addJob(
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
    const utils = await getWorkerUtils();
    await utils.addJob(
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
