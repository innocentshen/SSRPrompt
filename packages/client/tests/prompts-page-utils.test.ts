import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPromptMessageId,
  isAbortError,
  toApiMessages,
  toFrontendConfig,
} from '../src/lib/prompts-page-utils';
import { DEFAULT_PROMPT_CONFIG } from '../src/types/database';

test('toFrontendConfig applies prompt defaults when config is empty', () => {
  const result = toFrontendConfig({});

  assert.equal(result.temperature, DEFAULT_PROMPT_CONFIG.temperature);
  assert.equal(result.top_p, DEFAULT_PROMPT_CONFIG.top_p);
  assert.equal(result.max_tokens, DEFAULT_PROMPT_CONFIG.max_tokens);
  assert.equal(result.reasoning, undefined);
});

test('toApiMessages keeps role/content pairs', () => {
  const result = toApiMessages([
    { id: '1', role: 'system', content: 'sys' },
    { id: '2', role: 'user', content: 'hello' },
  ]);

  assert.deepEqual(result, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
  ]);
});

test('createPromptMessageId returns prefixed id', () => {
  assert.match(createPromptMessageId(), /^msg_/);
});

test('isAbortError identifies abort exceptions', () => {
  assert.equal(isAbortError(new DOMException('Aborted', 'AbortError')), true);
  assert.equal(isAbortError(new Error('other')), false);
});
