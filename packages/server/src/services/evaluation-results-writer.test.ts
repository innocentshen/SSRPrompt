import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertRunResults, type RunResultPayload } from './evaluation-results-writer.js';

type StoredResult = {
  id: string;
  evaluationId: string;
  runId: string;
  testCaseId: string;
  modelOutput?: string;
  passed: boolean;
  tokensInput: number;
  tokensOutput: number;
};

function buildFakeClient(store: Map<string, StoredResult>) {
  let idSeq = 1;
  const makeKey = (runId: string, testCaseId: string) => `${runId}:${testCaseId}`;

  return {
    testCaseResult: {
      findMany: async (args: { where: { runId: string; testCaseId: { in: string[] } } }) => {
        const keys = args.where.testCaseId.in.map((testCaseId) => makeKey(args.where.runId, testCaseId));
        return keys
          .map((key) => store.get(key))
          .filter((row): row is StoredResult => Boolean(row))
          .map((row) => ({ id: row.id, testCaseId: row.testCaseId }));
      },
      update: async (args: { where: { id: string }; data: Partial<StoredResult> }) => {
        const row = Array.from(store.values()).find((item) => item.id === args.where.id);
        if (!row) throw new Error('row not found');
        const next = { ...row, ...args.data } as StoredResult;
        store.set(makeKey(row.runId, row.testCaseId), next);
        return next;
      },
      create: async (args: { data: Omit<StoredResult, 'id'> }) => {
        const created: StoredResult = { id: `r${idSeq++}`, ...args.data };
        store.set(makeKey(created.runId, created.testCaseId), created);
        return created;
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
}

test('upsertRunResults deduplicates same test case in one batch', async () => {
  const store = new Map<string, StoredResult>();
  const client = buildFakeClient(store);

  const batch: RunResultPayload[] = [
    { testCaseId: 'case-1', modelOutput: 'old', passed: false, tokensInput: 1, tokensOutput: 1 },
    { testCaseId: 'case-1', modelOutput: 'new', passed: true, tokensInput: 2, tokensOutput: 2 },
  ];

  await upsertRunResults(client as any, 'eval-1', 'run-1', batch);

  assert.equal(store.size, 1);
  assert.equal(store.get('run-1:case-1')?.modelOutput, 'new');
  assert.equal(store.get('run-1:case-1')?.passed, true);
});

test('smoke: run result lifecycle keeps one row per run/test-case', async () => {
  const store = new Map<string, StoredResult>();
  const client = buildFakeClient(store);

  await upsertRunResults(client as any, 'eval-1', 'run-1', [
    { testCaseId: 'case-1', modelOutput: 'v1', passed: false, tokensInput: 10, tokensOutput: 5 },
    { testCaseId: 'case-2', modelOutput: 'v1', passed: true, tokensInput: 8, tokensOutput: 4 },
  ]);

  await upsertRunResults(client as any, 'eval-1', 'run-1', [
    { testCaseId: 'case-1', modelOutput: 'v2', passed: true, tokensInput: 12, tokensOutput: 6 },
  ]);

  assert.equal(store.size, 2);
  assert.equal(store.get('run-1:case-1')?.modelOutput, 'v2');
  assert.equal(store.get('run-1:case-1')?.passed, true);
  assert.equal(store.get('run-1:case-2')?.modelOutput, 'v1');
});
