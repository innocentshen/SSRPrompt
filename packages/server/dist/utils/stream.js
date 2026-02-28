import { Readable } from 'node:stream';
function isReadableStream(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.getReader === 'function');
}
function isBlob(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.stream === 'function');
}
export function toNodeReadable(body) {
    if (body instanceof Readable) {
        return body;
    }
    if (isReadableStream(body)) {
        return Readable.fromWeb(body);
    }
    if (isBlob(body)) {
        return Readable.fromWeb(body.stream());
    }
    if (body instanceof Uint8Array) {
        return Readable.from(body);
    }
    if (body instanceof ArrayBuffer) {
        return Readable.from(new Uint8Array(body));
    }
    if (body && typeof body === 'object') {
        const pipe = body.pipe;
        if (typeof pipe === 'function') {
            return body;
        }
    }
    throw new Error('Unsupported stream body');
}
//# sourceMappingURL=stream.js.map