import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { AppError } from '@ssrprompt/shared';
import type { Readable } from 'node:stream';

export type ZipReaderLimits = {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
};

function normalizeZipPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  const withoutDot = trimmed.replace(/^\.\//, '');
  return withoutDot;
}

function assertSafeZipPath(fileName: string): void {
  if (!fileName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ZIP entry has empty filename');
  }
  if (fileName.includes('\0')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ZIP entry has invalid filename');
  }
  if (fileName.startsWith('/') || /^[a-zA-Z]:\//.test(fileName)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ZIP entry path must be relative');
  }
  const segments = fileName.split('/');
  if (segments.some((seg) => seg === '..')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ZIP entry path traversal is not allowed');
  }
}

async function openZipFromBuffer(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error('Failed to open zip'));
        return;
      }
      resolve(zipFile);
    });
  });
}

function openReadStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('Failed to open zip entry stream'));
        return;
      }
      resolve(stream as unknown as Readable);
    });
  });
}

async function readStreamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    const onData = (chunk: unknown) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
      total += buf.length;
      if (total > maxBytes) {
        stream.destroy(new AppError(413, 'VALIDATION_ERROR', `ZIP entry exceeds size limit (${maxBytes} bytes)`));
        return;
      }
      chunks.push(buf);
    };

    const onError = (err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
      stream.removeListener('close', onEnd);
    };

    stream.on('data', onData);
    stream.on('error', onError);
    stream.on('end', onEnd);
    stream.on('close', onEnd);
  });
}

export class ZipReader {
  private constructor(
    private readonly zipFile: ZipFile,
    private readonly entriesByPath: Map<string, Entry>
  ) {}

  static async fromBuffer(buffer: Buffer, limits: ZipReaderLimits): Promise<ZipReader> {
    const zipFile = await openZipFromBuffer(buffer);
    const entriesByPath = new Map<string, Entry>();

    let entryCount = 0;
    let totalUncompressedBytes = 0;

    await new Promise<void>((resolve, reject) => {
      const onEntry = (entry: Entry) => {
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          reject(new AppError(413, 'VALIDATION_ERROR', `ZIP has too many entries (>${limits.maxEntries})`));
          return;
        }

        const normalized = normalizeZipPath(entry.fileName);
        assertSafeZipPath(normalized);

        if (normalized.endsWith('/')) {
          zipFile.readEntry();
          return;
        }

        totalUncompressedBytes += entry.uncompressedSize;
        if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
          reject(
            new AppError(
              413,
              'VALIDATION_ERROR',
              `ZIP uncompressed size exceeds limit (${limits.maxTotalUncompressedBytes} bytes)`
            )
          );
          return;
        }

        if (!entriesByPath.has(normalized)) {
          entriesByPath.set(normalized, entry);
        }

        zipFile.readEntry();
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const onEnd = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        zipFile.removeListener('entry', onEntry);
        zipFile.removeListener('error', onError);
        zipFile.removeListener('end', onEnd);
      };

      zipFile.on('entry', onEntry);
      zipFile.on('error', onError);
      zipFile.on('end', onEnd);

      zipFile.readEntry();
    });

    return new ZipReader(zipFile, entriesByPath);
  }

  listPaths(): string[] {
    return [...this.entriesByPath.keys()];
  }

  /**
   * Best-effort find by basename (case-insensitive).
   * Useful when users put `import.xlsx` inside a folder.
   */
  findByBasename(basename: string): string | null {
    const needle = basename.toLowerCase();
    for (const path of this.entriesByPath.keys()) {
      const last = path.split('/').pop() || '';
      if (last.toLowerCase() === needle) return path;
    }
    return null;
  }

  has(path: string): boolean {
    const normalized = normalizeZipPath(path);
    return this.entriesByPath.has(normalized);
  }

  async readBuffer(path: string, maxBytes: number): Promise<Buffer> {
    const normalized = normalizeZipPath(path);
    assertSafeZipPath(normalized);

    const entry = this.entriesByPath.get(normalized);
    if (!entry) {
      throw new AppError(404, 'NOT_FOUND', `ZIP entry not found: ${normalized}`);
    }

    if (entry.uncompressedSize > maxBytes) {
      throw new AppError(413, 'VALIDATION_ERROR', `ZIP entry exceeds size limit (${maxBytes} bytes): ${normalized}`);
    }

    const stream = await openReadStream(this.zipFile, entry);
    return readStreamToBuffer(stream, maxBytes);
  }

  close(): void {
    this.zipFile.close();
  }
}
