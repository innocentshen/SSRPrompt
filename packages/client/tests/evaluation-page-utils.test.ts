import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsv,
  formatAttachmentLinks,
  mergeResultsByTestCase,
  sanitizeFilenamePart,
} from '../src/lib/evaluation-page-utils';
import type { TestCaseResult } from '../src/types';

function makeResult(testCaseId: string, output: string): TestCaseResult {
  return {
    id: `${testCaseId}-id`,
    testCaseId,
    runId: 'run-1',
    evaluationId: 'eval-1',
    modelOutput: output,
    scores: {},
    aiFeedback: {},
    latencyMs: 0,
    ocrLatencyMs: 0,
    tokensInput: 0,
    tokensOutput: 0,
    passed: false,
    errorMessage: null,
    createdAt: new Date().toISOString(),
  } as TestCaseResult;
}

test('buildCsv escapes commas and quotes', () => {
  const csv = buildCsv(
    [{ key: 'name', label: 'Name' }, { key: 'note', label: 'Note' }],
    [{ name: 'demo', note: 'needs "quote", and comma' }]
  );

  assert.match(csv, /"needs ""quote"", and comma"/);
});

test('mergeResultsByTestCase replaces existing and appends new items', () => {
  const prev = [makeResult('case-1', 'old output')];
  const updates = [makeResult('case-1', 'new output'), makeResult('case-2', 'second')];
  const merged = mergeResultsByTestCase(prev, updates);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.testCaseId === 'case-1')?.modelOutput, 'new output');
  assert.equal(merged.find((item) => item.testCaseId === 'case-2')?.modelOutput, 'second');
});

test('formatAttachmentLinks creates API links for files', () => {
  const text = formatAttachmentLinks('http://localhost:3001/api/v1', [
    { fileId: 'file_123', name: 'contract.pdf', type: 'application/pdf' },
  ]);

  assert.equal(text, 'contract.pdf: http://localhost:3001/api/v1/files/file_123');
});

test('sanitizeFilenamePart strips invalid filename chars', () => {
  assert.equal(sanitizeFilenamePart('foo/bar:*?"<>|', 'fallback'), 'foo-bar-------');
});
