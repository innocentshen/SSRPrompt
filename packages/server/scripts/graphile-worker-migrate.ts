import '../src/config/env.js';

import { makeWorkerUtils } from 'graphile-worker';
import { env } from '../src/config/env.js';

async function main() {
  const utils = await makeWorkerUtils({ connectionString: env.DATABASE_URL, schema: env.GRAPHILE_WORKER_SCHEMA });
  await utils.migrate();
  await utils.release();
  console.log('Graphile Worker schema installed');
}

main().catch((error) => {
  console.error('Graphile Worker schema setup failed:', error);
  process.exit(1);
});
