import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const LEGACY_DRIFT_MIGRATIONS = [
  '20260128033207_provideupdata',
  '20260128120000_user_provider_settings',
  '20260202120000_ocr_paddle_vl_1_5_provider',
  '20260203120000_evaluation_share_attachments',
] as const;

type CliOptions = {
  databaseUrl?: string;
  resolveLegacy: boolean;
  skipStatus: boolean;
};

const serverRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function printHelp() {
  console.log(`Usage:
  pnpm --filter @ssrprompt/server prisma:migrate:target -- --database-url "<DATABASE_URL>" [--resolve-legacy] [--no-status]

Options:
  --database-url <url>   Target database URL. If omitted, uses DATABASE_URL env.
  --resolve-legacy       Mark known legacy drift migrations as applied before deploy.
  --no-status            Skip final prisma migrate status check.
  --help                 Show this help.
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { resolveLegacy: false, skipStatus: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--resolve-legacy') {
      options.resolveLegacy = true;
      continue;
    }
    if (arg === '--no-status') {
      options.skipStatus = true;
      continue;
    }
    if (arg === '--database-url') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --database-url');
      }
      options.databaseUrl = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--database-url=')) {
      options.databaseUrl = arg.slice('--database-url='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function maskDatabaseUrl(input: string) {
  try {
    const parsed = new URL(input);
    if (parsed.password) parsed.password = '******';
    return parsed.toString();
  } catch {
    return '[invalid DATABASE_URL format]';
  }
}

function runPrisma(argumentsList: string[], databaseUrl: string) {
  const result = spawnSync(pnpmCommand, ['exec', 'prisma', ...argumentsList], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: prisma ${argumentsList.join(' ')}`);
  }
}

async function resolveLegacyMigrations(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let appliedNames = new Set<string>();
  try {
    const queryResult = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM "_prisma_migrations"',
    );
    appliedNames = new Set(queryResult.rows.map((row) => row.migration_name));
  } catch (error) {
    const maybePg = error as { code?: string };
    if (maybePg.code === '42P01') {
      console.log('`_prisma_migrations` table not found, skipping legacy resolve.');
      await client.end();
      return;
    }
    await client.end();
    throw error;
  }
  await client.end();

  const pendingLegacy = LEGACY_DRIFT_MIGRATIONS.filter((name) => !appliedNames.has(name));
  if (pendingLegacy.length === 0) {
    console.log('No legacy drift migrations need resolve.');
    return;
  }

  console.log(`Resolving ${pendingLegacy.length} legacy drift migration(s) as applied...`);
  for (const migrationName of pendingLegacy) {
    runPrisma(['migrate', 'resolve', '--applied', migrationName], databaseUrl);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    printHelp();
    throw new Error('DATABASE_URL is required. Pass --database-url or set env DATABASE_URL.');
  }

  console.log(`Target DB: ${maskDatabaseUrl(databaseUrl)}`);
  if (options.resolveLegacy) {
    await resolveLegacyMigrations(databaseUrl);
  }

  runPrisma(['migrate', 'deploy'], databaseUrl);

  if (!options.skipStatus) {
    runPrisma(['migrate', 'status'], databaseUrl);
  }

  console.log('Schema migration completed successfully.');
}

main().catch((error) => {
  console.error('Target DB migration failed:', error);
  process.exit(1);
});
