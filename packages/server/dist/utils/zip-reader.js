import yauzl from 'yauzl';
import { AppError } from '@ssrprompt/shared';
function normalizeZipPath(value) {
    const trimmed = value.trim().replace(/\\/g, '/');
    const withoutDot = trimmed.replace(/^\.\//, '');
    return withoutDot;
}
function assertSafeZipPath(fileName) {
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
async function openZipFromBuffer(buffer) {
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
function openReadStream(zipFile, entry) {
    return new Promise((resolve, reject) => {
        zipFile.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
                reject(err ?? new Error('Failed to open zip entry stream'));
                return;
            }
            resolve(stream);
        });
    });
}
async function readStreamToBuffer(stream, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        const onData = (chunk) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > maxBytes) {
                stream.destroy(new AppError(413, 'VALIDATION_ERROR', `ZIP entry exceeds size limit (${maxBytes} bytes)`));
                return;
            }
            chunks.push(buf);
        };
        const onError = (err) => {
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
    constructor(zipFile, entriesByPath) {
        Object.defineProperty(this, "zipFile", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: zipFile
        });
        Object.defineProperty(this, "entriesByPath", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: entriesByPath
        });
    }
    static async fromBuffer(buffer, limits) {
        const zipFile = await openZipFromBuffer(buffer);
        const entriesByPath = new Map();
        let entryCount = 0;
        let totalUncompressedBytes = 0;
        await new Promise((resolve, reject) => {
            const onEntry = (entry) => {
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
                    reject(new AppError(413, 'VALIDATION_ERROR', `ZIP uncompressed size exceeds limit (${limits.maxTotalUncompressedBytes} bytes)`));
                    return;
                }
                if (!entriesByPath.has(normalized)) {
                    entriesByPath.set(normalized, entry);
                }
                zipFile.readEntry();
            };
            const onError = (err) => {
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
    listPaths() {
        return [...this.entriesByPath.keys()];
    }
    /**
     * Best-effort find by basename (case-insensitive).
     * Useful when users put `import.xlsx` inside a folder.
     */
    findByBasename(basename) {
        const needle = basename.toLowerCase();
        for (const path of this.entriesByPath.keys()) {
            const last = path.split('/').pop() || '';
            if (last.toLowerCase() === needle)
                return path;
        }
        return null;
    }
    has(path) {
        const normalized = normalizeZipPath(path);
        return this.entriesByPath.has(normalized);
    }
    async readBuffer(path, maxBytes) {
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
    close() {
        this.zipFile.close();
    }
}
//# sourceMappingURL=zip-reader.js.map