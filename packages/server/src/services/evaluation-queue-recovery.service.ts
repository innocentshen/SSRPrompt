import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { enqueueEvaluationImport } from './evaluation-import-queue.service.js';
import { enqueueEvaluationRun, enqueueEvaluationRetryScores, getEvaluationQueueDriver } from './evaluation-queue.service.js';

type QueueTask = 'evaluation.run' | 'evaluation.retry_scores';

let recoveryTimer: NodeJS.Timeout | null = null;
let recovering = false;

function resolveQueueTask(runConfig: unknown): QueueTask {
  if (runConfig && typeof runConfig === 'object' && !Array.isArray(runConfig)) {
    const value = (runConfig as Record<string, unknown>).queueTask;
    if (value === 'evaluation.retry_scores') {
      return value;
    }
  }
  return 'evaluation.run';
}

async function recoverPendingRuns(): Promise<void> {
  const threshold = new Date(Date.now() - env.EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS);
  const runs = await prisma.evaluationRun.findMany({
    where: {
      status: 'pending',
      createdAt: { lte: threshold },
    },
    select: {
      id: true,
      runConfig: true,
    },
    orderBy: { createdAt: 'asc' },
    take: env.EVALUATION_QUEUE_RECOVERY_RUN_BATCH_SIZE,
  });

  let repaired = 0;
  for (const run of runs) {
    const queueTask = resolveQueueTask(run.runConfig);
    try {
      if (queueTask === 'evaluation.retry_scores') {
        await enqueueEvaluationRetryScores('system-recovery', run.id);
      } else {
        await enqueueEvaluationRun('system-recovery', run.id);
      }
      repaired += 1;
    } catch (error) {
      console.error(`Queue recovery failed for run ${run.id}:`, error);
    }
  }

  if (repaired > 0) {
    console.log(`Queue recovery re-enqueued ${repaired} pending evaluation run(s).`);
  }
}

async function recoverPendingImports(): Promise<void> {
  const threshold = new Date(Date.now() - env.EVALUATION_QUEUE_RECOVERY_MIN_PENDING_AGE_MS);
  const jobs = await prisma.evaluationImportJob.findMany({
    where: {
      status: 'pending',
      createdAt: { lte: threshold },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: env.EVALUATION_QUEUE_RECOVERY_IMPORT_BATCH_SIZE,
  });

  let repaired = 0;
  for (const job of jobs) {
    try {
      await enqueueEvaluationImport(job.id);
      repaired += 1;
    } catch (error) {
      console.error(`Queue recovery failed for import job ${job.id}:`, error);
    }
  }

  if (repaired > 0) {
    console.log(`Queue recovery re-enqueued ${repaired} pending import job(s).`);
  }
}

async function runRecoveryCycle(): Promise<void> {
  if (recovering) return;
  recovering = true;
  try {
    await recoverPendingRuns();
    await recoverPendingImports();
  } catch (error) {
    console.error('Queue recovery cycle failed:', error);
  } finally {
    recovering = false;
  }
}

export function startEvaluationQueueRecoveryDaemon(): void {
  if (recoveryTimer) return;
  if (getEvaluationQueueDriver() !== 'pg') return;
  if (!env.EVALUATION_QUEUE_RECOVERY_ENABLED) return;

  recoveryTimer = setInterval(() => {
    void runRecoveryCycle();
  }, env.EVALUATION_QUEUE_RECOVERY_INTERVAL_MS);

  void runRecoveryCycle();
  console.log(
    `Queue recovery daemon started (interval=${env.EVALUATION_QUEUE_RECOVERY_INTERVAL_MS}ms, schema=${env.GRAPHILE_WORKER_SCHEMA}).`
  );
}

export async function stopEvaluationQueueRecoveryDaemon(): Promise<void> {
  if (!recoveryTimer) return;
  clearInterval(recoveryTimer);
  recoveryTimer = null;

  while (recovering) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
