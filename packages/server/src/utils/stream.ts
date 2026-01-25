import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getReader?: unknown }).getReader === 'function'
  );
}

function isBlob(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { stream?: unknown }).stream === 'function'
  );
}

export function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body;
  }

  if (isReadableStream(body)) {
    return Readable.fromWeb(body as unknown as NodeReadableStream);
  }

  if (isBlob(body)) {
    return Readable.fromWeb(body.stream() as unknown as NodeReadableStream);
  }

  if (body instanceof Uint8Array) {
    return Readable.from(body);
  }

  if (body instanceof ArrayBuffer) {
    return Readable.from(new Uint8Array(body));
  }

  if (body && typeof body === 'object') {
    const pipe = (body as { pipe?: unknown }).pipe;
    if (typeof pipe === 'function') {
      return body as Readable;
    }
  }

  throw new Error('Unsupported stream body');
}
