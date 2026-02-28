import { makeWorkerUtils } from 'graphile-worker';
import { env } from '../config/env.js';
import { evaluationRunner } from './evaluation-runner.service.js';
const QUEUE_DRIVER = (process.env.EVALUATION_QUEUE_DRIVER || 'memory').toLowerCase();
let workerUtilsPromise = null;
async function getWorkerUtils() {
    if (!workerUtilsPromise) {
        workerUtilsPromise = makeWorkerUtils({ connectionString: env.DATABASE_URL });
    }
    return workerUtilsPromise;
}
export async function enqueueEvaluationRun(userId, runId) {
    if (QUEUE_DRIVER === 'pg') {
        const utils = await getWorkerUtils();
        await utils.addJob('evaluation.run', { runId }, {
            maxAttempts: 1,
            jobKey: `evaluation.run:${runId}`,
            jobKeyMode: 'replace',
        });
        return;
    }
    await evaluationRunner.enqueue(userId, runId);
}
export function abortEvaluationRun(runId) {
    if (QUEUE_DRIVER === 'pg')
        return;
    evaluationRunner.abort(runId);
}
export function getEvaluationQueueDriver() {
    return QUEUE_DRIVER;
}
//# sourceMappingURL=evaluation-queue.service.js.map