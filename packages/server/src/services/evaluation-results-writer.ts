import type { Prisma } from '@prisma/client';

export type RunResultPayload = {
  testCaseId: string;
  modelOutput?: string;
  scores?: Record<string, number>;
  aiFeedback?: Prisma.JsonObject;
  latencyMs?: number;
  ocrLatencyMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  passed?: boolean;
  errorMessage?: string | null;
};

type TestCaseResultWriterClient = {
  $transaction: (operations: Prisma.PrismaPromise<unknown>[]) => Promise<unknown>;
  testCaseResult: {
    findMany: (args: Prisma.TestCaseResultFindManyArgs) => Prisma.PrismaPromise<Array<{ id: string; testCaseId: string }>>;
    update: (args: Prisma.TestCaseResultUpdateArgs) => Prisma.PrismaPromise<unknown>;
    create: (args: Prisma.TestCaseResultCreateArgs) => Prisma.PrismaPromise<unknown>;
  };
};

function normalizeResult(item: RunResultPayload): {
  modelOutput?: string;
  scores: Record<string, number>;
  aiFeedback: Prisma.JsonObject;
  latencyMs: number;
  ocrLatencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  passed: boolean;
  errorMessage: string | null;
} {
  return {
    modelOutput: item.modelOutput,
    scores: (item.scores as Record<string, number>) || {},
    aiFeedback: (item.aiFeedback ?? {}) as Prisma.JsonObject,
    latencyMs: item.latencyMs || 0,
    ocrLatencyMs: item.ocrLatencyMs || 0,
    tokensInput: item.tokensInput || 0,
    tokensOutput: item.tokensOutput || 0,
    passed: item.passed || false,
    errorMessage: item.errorMessage || null,
  };
}

export async function upsertRunResults(
  client: TestCaseResultWriterClient,
  evaluationId: string,
  runId: string,
  batch: RunResultPayload[]
): Promise<void> {
  if (batch.length === 0) return;

  // Last result for the same test case wins in the same flush.
  const deduped = new Map<string, RunResultPayload>();
  for (const item of batch) {
    deduped.set(item.testCaseId, item);
  }
  const items = Array.from(deduped.values());
  const testCaseIds = items.map((item) => item.testCaseId);

  const existingRows = await client.testCaseResult.findMany({
    where: {
      runId,
      testCaseId: { in: testCaseIds },
    },
    select: {
      id: true,
      testCaseId: true,
    },
  });
  const existingByTestCaseId = new Map(existingRows.map((row) => [row.testCaseId, row.id]));

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  for (const item of items) {
    const normalized = normalizeResult(item);
    const existingId = existingByTestCaseId.get(item.testCaseId);

    if (existingId) {
      operations.push(
        client.testCaseResult.update({
          where: { id: existingId },
          data: normalized,
        })
      );
      continue;
    }

    operations.push(
      client.testCaseResult.create({
        data: {
          evaluationId,
          runId,
          testCaseId: item.testCaseId,
          ...normalized,
        },
      })
    );
  }

  if (operations.length === 0) return;
  await client.$transaction(operations);
}
