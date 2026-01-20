import './config/env.js';

import { run } from 'graphile-worker';
import type { TaskList } from 'graphile-worker';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { executeEvaluationRun } from './services/evaluation-runner.service.js';

const taskList: TaskList = {
  'evaluation.run': async (payload) => {
    const data = payload as { runId?: unknown } | null;
    const runId = data && typeof data.runId === 'string' ? data.runId : null;
    if (!runId) {
      throw new Error('evaluation.run payload missing runId');
    }
    await executeEvaluationRun(runId);
  },
};

async function main() {
  await connectDatabase();

  const concurrency = Math.max(1, Number(process.env.EVALUATION_RUN_CONCURRENCY || '1'));
  const pollInterval = Math.max(500, Number(process.env.EVALUATION_WORKER_POLL_INTERVAL_MS || '1000'));

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency,
    pollInterval,
    taskList,
  });

  console.log('Worker started');

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down worker...`);
    await runner.stop();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
