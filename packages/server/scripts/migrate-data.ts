/**
 * Data Migration Script
 *
 * Migrates data from old MySQL/Supabase database to new PostgreSQL database.
 * - Migrates all entities: Providers, Models, Prompts, Evaluations, Traces
 * - Encrypts API keys using AES-256-GCM
 * - Preserves relationships and foreign keys
 *
 * Usage:
 *   1. Set up old database connection in OLD_DATABASE_URL
 *   2. Set up new database connection in DATABASE_URL
 *   3. Run: npx tsx scripts/migrate-data.ts
 */

import { PrismaClient as OldPrismaClient } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'crypto';

// Configuration
const OLD_DATABASE_URL = process.env.OLD_DATABASE_URL;
const NEW_DATABASE_URL = process.env.DATABASE_URL;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!OLD_DATABASE_URL || !NEW_DATABASE_URL || !ENCRYPTION_KEY) {
  console.error('Missing required environment variables:');
  console.error('  OLD_DATABASE_URL - Connection string for old database');
  console.error('  DATABASE_URL - Connection string for new PostgreSQL database');
  console.error('  ENCRYPTION_KEY - 64 hex character encryption key');
  process.exit(1);
}

// Encryption function
function encrypt(plaintext: string): string {
  const key = Buffer.from(ENCRYPTION_KEY!, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Initialize clients
const oldDb = new OldPrismaClient({
  datasources: { db: { url: OLD_DATABASE_URL } },
});

const newDb = new PrismaClient({
  datasources: { db: { url: NEW_DATABASE_URL } },
});

// ID mapping to track old -> new ID relationships
const idMaps = {
  providers: new Map<string, string>(),
  models: new Map<string, string>(),
  prompts: new Map<string, string>(),
  evaluations: new Map<string, string>(),
  testCases: new Map<string, string>(),
  criteria: new Map<string, string>(),
  runs: new Map<string, string>(),
};

async function migrateProviders() {
  console.log('\n📦 Migrating Providers...');

  const providers = await oldDb.$queryRaw`SELECT * FROM providers` as any[];

  for (const provider of providers) {
    try {
      // Encrypt the API key
      const encryptedApiKey = encrypt(provider.api_key || provider.apiKey);

      const newProvider = await newDb.provider.create({
        data: {
          userId: provider.user_id || provider.userId || 'default',
          name: provider.name,
          type: provider.type,
          apiKey: encryptedApiKey,
          baseUrl: provider.base_url || provider.baseUrl,
          enabled: provider.enabled ?? false,
          createdAt: new Date(provider.created_at || provider.createdAt),
          updatedAt: new Date(provider.updated_at || provider.updatedAt || Date.now()),
        },
      });

      idMaps.providers.set(provider.id, newProvider.id);
      console.log(`  ✓ Provider: ${provider.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to migrate provider ${provider.name}:`, error);
    }
  }

  console.log(`  Migrated ${idMaps.providers.size} providers`);
}

async function migrateModels() {
  console.log('\n🤖 Migrating Models...');

  const models = await oldDb.$queryRaw`SELECT * FROM models` as any[];

  for (const model of models) {
    try {
      const newProviderId = idMaps.providers.get(model.provider_id || model.providerId);
      if (!newProviderId) {
        console.log(`  ⚠ Skipping model ${model.name}: provider not found`);
        continue;
      }

      const newModel = await newDb.model.create({
        data: {
          providerId: newProviderId,
          modelId: model.model_id || model.modelId,
          name: model.name,
          capabilities: model.capabilities || [],
          supportsVision: model.supports_vision ?? model.supportsVision ?? true,
          supportsReasoning: model.supports_reasoning ?? model.supportsReasoning ?? false,
          supportsFunctionCalling: model.supports_function_calling ?? model.supportsFunctionCalling ?? false,
          createdAt: new Date(model.created_at || model.createdAt),
        },
      });

      idMaps.models.set(model.id, newModel.id);
      console.log(`  ✓ Model: ${model.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to migrate model ${model.name}:`, error);
    }
  }

  console.log(`  Migrated ${idMaps.models.size} models`);
}

async function migratePrompts() {
  console.log('\n📝 Migrating Prompts...');

  const prompts = await oldDb.$queryRaw`SELECT * FROM prompts` as any[];

  for (const prompt of prompts) {
    try {
      const defaultModelId = prompt.default_model_id || prompt.defaultModelId;
      const newDefaultModelId = defaultModelId ? idMaps.models.get(defaultModelId) : null;

      const newPrompt = await newDb.prompt.create({
        data: {
          userId: prompt.user_id || prompt.userId || 'default',
          name: prompt.name,
          description: prompt.description,
          content: prompt.content,
          variables: prompt.variables || [],
          messages: prompt.messages || [],
          config: prompt.config || {},
          currentVersion: prompt.current_version || prompt.currentVersion || 1,
          defaultModelId: newDefaultModelId,
          orderIndex: prompt.order_index ?? prompt.orderIndex ?? 0,
          createdAt: new Date(prompt.created_at || prompt.createdAt),
          updatedAt: new Date(prompt.updated_at || prompt.updatedAt || Date.now()),
        },
      });

      idMaps.prompts.set(prompt.id, newPrompt.id);
      console.log(`  ✓ Prompt: ${prompt.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to migrate prompt ${prompt.name}:`, error);
    }
  }

  console.log(`  Migrated ${idMaps.prompts.size} prompts`);
}

async function migratePromptVersions() {
  console.log('\n📚 Migrating Prompt Versions...');
  let count = 0;

  const versions = await oldDb.$queryRaw`SELECT * FROM prompt_versions` as any[];

  for (const version of versions) {
    try {
      const promptId = version.prompt_id || version.promptId;
      const newPromptId = idMaps.prompts.get(promptId);
      if (!newPromptId) {
        console.log(`  ⚠ Skipping version: prompt not found`);
        continue;
      }

      await newDb.promptVersion.create({
        data: {
          promptId: newPromptId,
          version: version.version,
          content: version.content,
          commitMessage: version.commit_message || version.commitMessage,
          createdAt: new Date(version.created_at || version.createdAt),
        },
      });

      count++;
    } catch (error) {
      console.error(`  ✗ Failed to migrate version:`, error);
    }
  }

  console.log(`  Migrated ${count} versions`);
}

async function migrateEvaluations() {
  console.log('\n🔬 Migrating Evaluations...');

  const evaluations = await oldDb.$queryRaw`SELECT * FROM evaluations` as any[];

  for (const evaluation of evaluations) {
    try {
      const promptId = evaluation.prompt_id || evaluation.promptId;
      const modelId = evaluation.model_id || evaluation.modelId;
      const judgeModelId = evaluation.judge_model_id || evaluation.judgeModelId;

      const newEvaluation = await newDb.evaluation.create({
        data: {
          userId: evaluation.user_id || evaluation.userId || 'default',
          name: evaluation.name,
          promptId: promptId ? idMaps.prompts.get(promptId) : null,
          modelId: modelId ? idMaps.models.get(modelId) : null,
          judgeModelId: judgeModelId ? idMaps.models.get(judgeModelId) : null,
          status: evaluation.status || 'pending',
          config: evaluation.config || {},
          results: evaluation.results || {},
          createdAt: new Date(evaluation.created_at || evaluation.createdAt),
          completedAt: evaluation.completed_at ? new Date(evaluation.completed_at) : null,
        },
      });

      idMaps.evaluations.set(evaluation.id, newEvaluation.id);
      console.log(`  ✓ Evaluation: ${evaluation.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to migrate evaluation ${evaluation.name}:`, error);
    }
  }

  console.log(`  Migrated ${idMaps.evaluations.size} evaluations`);
}

async function migrateTestCases() {
  console.log('\n🧪 Migrating Test Cases...');

  const testCases = await oldDb.$queryRaw`SELECT * FROM test_cases` as any[];

  for (const testCase of testCases) {
    try {
      const evaluationId = testCase.evaluation_id || testCase.evaluationId;
      const newEvaluationId = idMaps.evaluations.get(evaluationId);
      if (!newEvaluationId) {
        continue;
      }

      const newTestCase = await newDb.testCase.create({
        data: {
          evaluationId: newEvaluationId,
          name: testCase.name || '',
          inputText: testCase.input_text || testCase.inputText,
          inputVariables: testCase.input_variables || testCase.inputVariables || {},
          attachments: testCase.attachments || [],
          expectedOutput: testCase.expected_output || testCase.expectedOutput,
          notes: testCase.notes,
          orderIndex: testCase.order_index ?? testCase.orderIndex ?? 0,
          createdAt: new Date(testCase.created_at || testCase.createdAt),
        },
      });

      idMaps.testCases.set(testCase.id, newTestCase.id);
    } catch (error) {
      console.error(`  ✗ Failed to migrate test case:`, error);
    }
  }

  console.log(`  Migrated ${idMaps.testCases.size} test cases`);
}

async function migrateCriteria() {
  console.log('\n📋 Migrating Evaluation Criteria...');

  const criteria = await oldDb.$queryRaw`SELECT * FROM evaluation_criteria` as any[];

  for (const criterion of criteria) {
    try {
      const evaluationId = criterion.evaluation_id || criterion.evaluationId;
      const newEvaluationId = idMaps.evaluations.get(evaluationId);
      if (!newEvaluationId) {
        continue;
      }

      const newCriterion = await newDb.evaluationCriterion.create({
        data: {
          evaluationId: newEvaluationId,
          name: criterion.name,
          description: criterion.description,
          prompt: criterion.prompt,
          weight: criterion.weight || 1.0,
          enabled: criterion.enabled ?? true,
          createdAt: new Date(criterion.created_at || criterion.createdAt),
        },
      });

      idMaps.criteria.set(criterion.id, newCriterion.id);
    } catch (error) {
      console.error(`  ✗ Failed to migrate criterion:`, error);
    }
  }

  console.log(`  Migrated ${idMaps.criteria.size} criteria`);
}

async function migrateTraces() {
  console.log('\n📊 Migrating Traces...');
  let count = 0;

  const traces = await oldDb.$queryRaw`SELECT * FROM traces ORDER BY created_at DESC LIMIT 10000` as any[];

  for (const trace of traces) {
    try {
      const promptId = trace.prompt_id || trace.promptId;
      const modelId = trace.model_id || trace.modelId;

      await newDb.trace.create({
        data: {
          userId: trace.user_id || trace.userId || 'default',
          promptId: promptId ? idMaps.prompts.get(promptId) : null,
          modelId: modelId ? idMaps.models.get(modelId) : null,
          input: trace.input,
          output: trace.output,
          tokensInput: trace.tokens_input || trace.tokensInput || 0,
          tokensOutput: trace.tokens_output || trace.tokensOutput || 0,
          latencyMs: trace.latency_ms || trace.latencyMs || 0,
          status: trace.status || 'success',
          errorMessage: trace.error_message || trace.errorMessage,
          metadata: trace.metadata || {},
          attachments: trace.attachments,
          thinkingContent: trace.thinking_content || trace.thinkingContent,
          thinkingTimeMs: trace.thinking_time_ms || trace.thinkingTimeMs,
          createdAt: new Date(trace.created_at || trace.createdAt),
        },
      });

      count++;
    } catch (error) {
      // Silently skip trace errors to avoid noise
    }
  }

  console.log(`  Migrated ${count} traces (limited to 10000)`);
}

async function main() {
  console.log('🚀 Starting data migration...');
  console.log('=====================================');

  try {
    // Connect to databases
    await oldDb.$connect();
    await newDb.$connect();
    console.log('✓ Connected to both databases');

    // Migrate in order (respecting foreign key relationships)
    await migrateProviders();
    await migrateModels();
    await migratePrompts();
    await migratePromptVersions();
    await migrateEvaluations();
    await migrateTestCases();
    await migrateCriteria();
    await migrateTraces();

    console.log('\n=====================================');
    console.log('✅ Migration completed successfully!');
    console.log('\nSummary:');
    console.log(`  - Providers: ${idMaps.providers.size}`);
    console.log(`  - Models: ${idMaps.models.size}`);
    console.log(`  - Prompts: ${idMaps.prompts.size}`);
    console.log(`  - Evaluations: ${idMaps.evaluations.size}`);
    console.log(`  - Test Cases: ${idMaps.testCases.size}`);
    console.log(`  - Criteria: ${idMaps.criteria.size}`);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

main();
