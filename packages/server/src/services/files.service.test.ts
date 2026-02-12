import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { ensureServerTestEnv } from '../test/test-env.js';

function buildMeta(size: number) {
  return {
    id: 'file-1',
    userId: 'user-1',
    originalName: 'file.txt',
    mimeType: 'text/plain',
    size,
    sha256: 'abc',
    bucket: 'bucket',
    objectKey: 'key',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test('downloadBuffer rejects when metadata size exceeds limit', async () => {
  ensureServerTestEnv();
  const { FilesService } = await import('./files.service.js');

  const service = new FilesService();
  (service as unknown as { download: (...args: unknown[]) => Promise<unknown> }).download = async () => ({
    meta: buildMeta(10),
    body: Readable.from([Buffer.from('1234567890')]),
  });

  await assert.rejects(
    () => service.downloadBuffer('user-1', 'file-1', { maxBytes: 5 }),
    /exceeds size limit/
  );
});

test('downloadBuffer enforces streamed byte limit', async () => {
  ensureServerTestEnv();
  const { FilesService } = await import('./files.service.js');

  const service = new FilesService();
  (service as unknown as { download: (...args: unknown[]) => Promise<unknown> }).download = async () => ({
    meta: buildMeta(4),
    body: Readable.from([Buffer.from('1234'), Buffer.from('56')]),
  });

  await assert.rejects(
    () => service.downloadBuffer('user-1', 'file-1', { maxBytes: 5 }),
    /exceeds size limit/
  );
});

test('downloadBuffer returns full buffer within limit', async () => {
  ensureServerTestEnv();
  const { FilesService } = await import('./files.service.js');

  const service = new FilesService();
  (service as unknown as { download: (...args: unknown[]) => Promise<unknown> }).download = async () => ({
    meta: buildMeta(4),
    body: Readable.from([Buffer.from('12'), Buffer.from('34')]),
  });

  const result = await service.downloadBuffer('user-1', 'file-1', { maxBytes: 5 });
  assert.equal(result.buffer.toString('utf-8'), '1234');
  assert.equal(result.meta.size, 4);
});
