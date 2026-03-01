import { evaluationImportsService } from './evaluation-imports.service.js';
import { getEvaluationQueueDriver } from './evaluation-queue.service.js';
import { enqueueGraphileJob } from './graphile-queue.service.js';
class EvaluationImportQueue {
    constructor() {
        Object.defineProperty(this, "pending", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "active", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "maxConcurrent", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Math.max(1, Number(process.env.EVALUATION_IMPORT_CONCURRENCY || '1'))
        });
    }
    enqueue(jobId) {
        return new Promise((resolve, reject) => {
            this.pending.push({ jobId, resolve, reject });
            this.process();
        });
    }
    process() {
        while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
            const job = this.pending.shift();
            if (!job)
                return;
            this.active.add(job.jobId);
            evaluationImportsService
                .execute(job.jobId)
                .then(() => job.resolve())
                .catch((error) => job.reject(error))
                .finally(() => {
                this.active.delete(job.jobId);
                this.process();
            });
        }
    }
}
export const evaluationImportRunner = new EvaluationImportQueue();
export async function enqueueEvaluationImport(jobId) {
    const driver = getEvaluationQueueDriver();
    if (driver === 'pg') {
        await enqueueGraphileJob('evaluation.import', { jobId }, {
            maxAttempts: 1,
            jobKey: `evaluation.import:${jobId}`,
            jobKeyMode: 'replace',
        });
        return;
    }
    await evaluationImportRunner.enqueue(jobId);
}
//# sourceMappingURL=evaluation-import-queue.service.js.map