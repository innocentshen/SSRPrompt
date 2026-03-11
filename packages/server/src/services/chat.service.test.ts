import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServerTestEnv } from '../test/test-env.js';

function createProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    userId: 'user-1',
    name: 'Gemini',
    type: 'gemini',
    apiKey: 'test-key',
    baseUrl: null,
    enabled: true,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-1',
    providerId: 'provider-1',
    name: 'Gemini Model',
    modelId: 'gemini-2.0-flash',
    supportsVision: true,
    supportsPdf: true,
    supportsReasoning: false,
    inputPricePerM: null,
    outputPricePerM: null,
    contextWindow: null,
    maxOutputTokens: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test('buildRequestBody omits Gemini thinkingConfig when reasoning is not enabled', async () => {
  ensureServerTestEnv();
  const { buildRequestBody } = await import('./chat.service.js');

  const body = buildRequestBody(
    createProvider() as any,
    createModel() as any,
    [{ role: 'user', content: 'hello' }],
    {}
  );

  assert.equal((body as { generationConfig?: Record<string, unknown> }).generationConfig, undefined);
});

test('buildRequestBody omits Gemini thinkingConfig when reasoning is explicitly set to none', async () => {
  ensureServerTestEnv();
  const { buildRequestBody } = await import('./chat.service.js');

  const body = buildRequestBody(
    createProvider() as any,
    createModel({ supportsReasoning: true }) as any,
    [{ role: 'user', content: 'hello' }],
    { reasoning: { enabled: true, effort: 'none' } }
  );

  assert.equal((body as { generationConfig?: Record<string, unknown> }).generationConfig, undefined);
});

test('buildRequestBody includes Gemini thinkingConfig only when reasoning is explicitly enabled', async () => {
  ensureServerTestEnv();
  const { buildRequestBody } = await import('./chat.service.js');

  const body = buildRequestBody(
    createProvider() as any,
    createModel({ modelId: 'gemini-3-flash', supportsReasoning: true }) as any,
    [{ role: 'user', content: 'hello' }],
    { reasoning: { enabled: true, effort: 'high' } }
  ) as { generationConfig?: { thinkingConfig?: Record<string, unknown> } };

  assert.deepEqual(body.generationConfig?.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'high',
  });
});
