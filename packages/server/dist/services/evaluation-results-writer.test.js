import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertRunResults } from './evaluation-results-writer.js';
function buildFakeClient(store) {
    let idSeq = 1;
    const makeKey = (runId, testCaseId) => `${runId}:${testCaseId}`;
    return {
        testCaseResult: {
            findMany: async (args) => {
                const keys = args.where.testCaseId.in.map((testCaseId) => makeKey(args.where.runId, testCaseId));
                return keys
                    .map((key) => store.get(key))
                    .filter((row) => Boolean(row))
                    .map((row) => ({ id: row.id, testCaseId: row.testCaseId }));
            },
            update: async (args) => {
                const row = Array.from(store.values()).find((item) => item.id === args.where.id);
                if (!row)
                    throw new Error('row not found');
                const next = { ...row, ...args.data };
                store.set(makeKey(row.runId, row.testCaseId), next);
                return next;
            },
            create: async (args) => {
                const created = { id: `r${idSeq++}`, ...args.data };
                store.set(makeKey(created.runId, created.testCaseId), created);
                return created;
            },
        },
        $transaction: async (operations) => Promise.all(operations),
    };
}
test('upsertRunResults deduplicates same test case in one batch', async () => {
    const store = new Map();
    const client = buildFakeClient(store);
    const batch = [
        { testCaseId: 'case-1', modelOutput: 'old', passed: false, tokensInput: 1, tokensOutput: 1 },
        { testCaseId: 'case-1', modelOutput: 'new', passed: true, tokensInput: 2, tokensOutput: 2 },
    ];
    await upsertRunResults(client, 'eval-1', 'run-1', batch);
    assert.equal(store.size, 1);
    assert.equal(store.get('run-1:case-1')?.modelOutput, 'new');
    assert.equal(store.get('run-1:case-1')?.passed, true);
});
test('smoke: run result lifecycle keeps one row per run/test-case', async () => {
    const store = new Map();
    const client = buildFakeClient(store);
    await upsertRunResults(client, 'eval-1', 'run-1', [
        { testCaseId: 'case-1', modelOutput: 'v1', passed: false, tokensInput: 10, tokensOutput: 5 },
        { testCaseId: 'case-2', modelOutput: 'v1', passed: true, tokensInput: 8, tokensOutput: 4 },
    ]);
    await upsertRunResults(client, 'eval-1', 'run-1', [
        { testCaseId: 'case-1', modelOutput: 'v2', passed: true, tokensInput: 12, tokensOutput: 6 },
    ]);
    assert.equal(store.size, 2);
    assert.equal(store.get('run-1:case-1')?.modelOutput, 'v2');
    assert.equal(store.get('run-1:case-1')?.passed, true);
    assert.equal(store.get('run-1:case-2')?.modelOutput, 'v1');
});
//# sourceMappingURL=evaluation-results-writer.test.js.map