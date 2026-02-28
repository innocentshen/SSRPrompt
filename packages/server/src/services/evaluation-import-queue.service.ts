import { evaluationImportsService } from './evaluation-imports.service.js';
import { getEvaluationQueueDriver } from './evaluation-queue.service.js';
import { enqueueGraphileJob } from './graphile-queue.service.js';

type ImportJob = {
  jobId: string;
  resolve: () => void;
  reject: (error: Error) => void;
};

class EvaluationImportQueue {
  private readonly pending: ImportJob[] = [];
  private readonly active = new Set<string>();
  private readonly maxConcurrent = Math.max(1, Number(process.env.EVALUATION_IMPORT_CONCURRENCY || '1'));

  enqueue(jobId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ jobId, resolve, reject });
      this.process();
    });
  }

  private process() {
    while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) return;
      this.active.add(job.jobId);
      evaluationImportsService
        .execute(job.jobId)
        .then(() => job.resolve())
        .catch((error) => job.reject(error as Error))
        .finally(() => {
          this.active.delete(job.jobId);
          this.process();
        });
    }
  }
}

export const evaluationImportRunner = new EvaluationImportQueue();

export async function enqueueEvaluationImport(jobId: string): Promise<void> {
  const driver = getEvaluationQueueDriver();
  if (driver === 'pg') {
    await enqueueGraphileJob(
      'evaluation.import',
      { jobId },
      {
        maxAttempts: 1,
        jobKey: `evaluation.import:${jobId}`,
        jobKeyMode: 'replace',
      }
    );
    return;
  }

  await evaluationImportRunner.enqueue(jobId);
}

