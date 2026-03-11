import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppError } from '@ssrprompt/shared';

type RasterizedPdfImage = {
  pageNumber: number;
  mimeType: string;
  buffer: Buffer;
  width: number | null;
  height: number | null;
};

type RasterizedPdfImagePayload = {
  pageNumber?: unknown;
  mimeType?: unknown;
  dataBase64?: unknown;
  width?: unknown;
  height?: unknown;
};

type RasterizedPdfResponse = {
  engine?: unknown;
  images?: unknown;
};

class ConcurrencyGate {
  private active = 0;

  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

function parsePositiveInt(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

const DEFAULT_PDF_IMAGE_DPI = parsePositiveInt(process.env.OCR_MULTIMODAL_PDF_IMAGE_DPI, 144, 72);
const DEFAULT_RASTER_TIMEOUT_MS = parsePositiveInt(process.env.OCR_PDF_RASTER_TIMEOUT_MS, 120000, 5000);
const DEFAULT_RASTER_CONCURRENCY = parsePositiveInt(process.env.OCR_PDF_RASTER_CONCURRENCY, 2, 1);
const PYTHON_COMMAND = process.env.OCR_PDF_TO_IMAGES_PYTHON || process.env.PYTHON || 'python';
const PYTHON_SCRIPT_PATH = fileURLToPath(new URL('../../scripts/pdf_to_images.py', import.meta.url));

function normalizeImagePayload(payload: RasterizedPdfImagePayload, index: number): RasterizedPdfImage {
  if (typeof payload.mimeType !== 'string' || !payload.mimeType.trim()) {
    throw new AppError(500, 'PROVIDER_ERROR', `Rasterized PDF page ${index + 1} is missing mimeType`);
  }
  if (typeof payload.dataBase64 !== 'string' || !payload.dataBase64.trim()) {
    throw new AppError(500, 'PROVIDER_ERROR', `Rasterized PDF page ${index + 1} is missing image data`);
  }

  return {
    pageNumber:
      typeof payload.pageNumber === 'number' && Number.isFinite(payload.pageNumber)
        ? Math.max(1, Math.trunc(payload.pageNumber))
        : index + 1,
    mimeType: payload.mimeType.trim(),
    buffer: Buffer.from(payload.dataBase64, 'base64'),
    width:
      typeof payload.width === 'number' && Number.isFinite(payload.width)
        ? Math.max(1, Math.trunc(payload.width))
        : null,
    height:
      typeof payload.height === 'number' && Number.isFinite(payload.height)
        ? Math.max(1, Math.trunc(payload.height))
        : null,
  };
}

export class PdfToImagesService {
  private readonly gate = new ConcurrencyGate(DEFAULT_RASTER_CONCURRENCY);

  async rasterize(
    pdfBuffer: Buffer,
    options?: { dpi?: number; timeoutMs?: number }
  ): Promise<{ engine: string; images: RasterizedPdfImage[] }> {
    return this.gate.run(async () => {
      const dpi =
        typeof options?.dpi === 'number' && Number.isFinite(options.dpi)
          ? Math.max(72, Math.trunc(options.dpi))
          : DEFAULT_PDF_IMAGE_DPI;
      const timeoutMs =
        typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
          ? Math.max(5_000, Math.trunc(options.timeoutMs))
          : DEFAULT_RASTER_TIMEOUT_MS;

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const child = spawn(PYTHON_COMMAND, [PYTHON_SCRIPT_PATH, '--dpi', String(dpi)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        child.kill();
      }, timeoutMs);

      return await new Promise<{ engine: string; images: RasterizedPdfImage[] }>((resolve, reject) => {
        const finishWithError = (message: string, details?: Record<string, unknown>) => {
          clearTimeout(timeout);
          reject(new AppError(500, 'PROVIDER_ERROR', message, details));
        };

        child.on('error', (error) => {
          const message = error.message?.trim() || 'Unknown process error';
          finishWithError(
            'PDF rasterization service is unavailable. Please ensure Python and PyMuPDF or pypdfium2 are installed.',
            { cause: message }
          );
        });

        child.stdout.on('data', (chunk: Buffer | string) => {
          stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        child.on('close', (code, signal) => {
          clearTimeout(timeout);

          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
          if (signal) {
            finishWithError('PDF rasterization timed out', { signal, timeoutMs, stderr: stderr || undefined });
            return;
          }
          if (code !== 0) {
            finishWithError('PDF rasterization failed', { exitCode: code, stderr: stderr || undefined });
            return;
          }

          try {
            const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
            const parsed = JSON.parse(stdout) as RasterizedPdfResponse;
            const imagesRaw = Array.isArray(parsed.images) ? parsed.images : null;
            if (!imagesRaw || imagesRaw.length === 0) {
              finishWithError('PDF rasterization returned no page images');
              return;
            }

            const images = imagesRaw.map((item, index) =>
              normalizeImagePayload((item ?? {}) as RasterizedPdfImagePayload, index)
            );

            resolve({
              engine: typeof parsed.engine === 'string' && parsed.engine.trim() ? parsed.engine.trim() : 'unknown',
              images,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            finishWithError('PDF rasterization returned invalid output', { cause: message, stderr: stderr || undefined });
          }
        });

        child.stdin.on('error', (error) => {
          const message = error.message?.trim() || 'Unknown stdin error';
          finishWithError('Failed to stream PDF bytes to rasterization service', { cause: message });
        });

        child.stdin.end(pdfBuffer);
      });
    });
  }
}

export const pdfToImagesService = new PdfToImagesService();
