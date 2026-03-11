import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServerTestEnv } from '../test/test-env.js';

test('buildMultimodalOcrUserParts puts Gemini PDF attachment before prompt', async () => {
  ensureServerTestEnv();
  const { buildMultimodalOcrUserParts } = await import('./ocr-helpers.js');

  const parts = buildMultimodalOcrUserParts(
    { modelId: 'model-1', prompt: 'Extract to Markdown', temperature: 0, topP: null, maxTokens: null, frequencyPenalty: null, presencePenalty: null, pdfToImages: false },
    {
      buffer: Buffer.from('pdf-data'),
      mimeType: 'application/pdf',
      filename: 'sample.pdf',
    },
    'gemini'
  );

  assert.equal(parts[0]?.type, 'file');
  assert.equal(parts[1]?.type, 'text');
});

test('buildMultimodalOcrUserParts keeps prompt first for non-Gemini PDFs', async () => {
  ensureServerTestEnv();
  const { buildMultimodalOcrUserParts } = await import('./ocr-helpers.js');

  const parts = buildMultimodalOcrUserParts(
    { modelId: 'model-1', prompt: 'Extract to Markdown', temperature: 0, topP: null, maxTokens: null, frequencyPenalty: null, presencePenalty: null, pdfToImages: false },
    {
      buffer: Buffer.from('pdf-data'),
      mimeType: 'application/pdf',
      filename: 'sample.pdf',
    },
    'openai'
  );

  assert.equal(parts[0]?.type, 'text');
  assert.equal(parts[1]?.type, 'file');
});

test('buildMultimodalOcrUserPartsFromPageImages preserves page order', async () => {
  ensureServerTestEnv();
  const { buildMultimodalOcrUserPartsFromPageImages } = await import('./ocr-helpers.js');

  const parts = buildMultimodalOcrUserPartsFromPageImages(
    { modelId: 'model-1', prompt: 'Extract to Markdown', temperature: 0, topP: null, maxTokens: null, frequencyPenalty: null, presencePenalty: null, pdfToImages: true },
    [
      { mimeType: 'image/png', dataUrl: 'data:image/png;base64,page-1' },
      { mimeType: 'image/png', dataUrl: 'data:image/png;base64,page-2' },
    ]
  );

  assert.equal(parts[0]?.type, 'text');
  assert.equal(parts[1]?.type, 'text');
  assert.equal(parts[2]?.type, 'image_url');
  assert.equal(parts[3]?.type, 'text');
  assert.equal(parts[4]?.type, 'image_url');
});

test('supportsMultimodalPdfInput rejects glm-style custom models and accepts gemini', async () => {
  ensureServerTestEnv();
  const { supportsMultimodalPdfInput } = await import('./ocr-helpers.js');

  assert.equal(supportsMultimodalPdfInput('custom', 'glm-4.6v-flashx'), false);
  assert.equal(supportsMultimodalPdfInput('gemini', 'gemini-2.5-flash'), true);
  assert.equal(supportsMultimodalPdfInput('openai', 'gpt-4o-mini'), true);
});

test('assertNonEmptyOcrOutput rejects empty OCR payloads', async () => {
  ensureServerTestEnv();
  const { assertNonEmptyOcrOutput } = await import('./ocr-helpers.js');

  assert.throws(() => assertNonEmptyOcrOutput('   \n\t  '), /OCR returned empty content/);
  assert.doesNotThrow(() => assertNonEmptyOcrOutput('hello'));
});
