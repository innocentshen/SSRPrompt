import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, NotFoundError } from '@ssrprompt/shared';
import { filesRepository } from '../repositories/files.repository.js';
import { getS3Client } from '../config/s3.js';
import { toNodeReadable } from '../utils/stream.js';
const DEFAULT_BUFFER_DOWNLOAD_MAX_BYTES = Math.max(1, Number(process.env.FILES_BUFFER_DOWNLOAD_MAX_BYTES || String(20 * 1024 * 1024)));
export class FilesService {
    async upload(userId, input) {
        const { client, bucket } = getS3Client();
        const sha256 = createHash('sha256').update(input.buffer).digest('hex');
        const id = randomUUID();
        const objectKey = `${userId}/${id}`;
        await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: input.buffer,
            ContentType: input.mimeType,
        }));
        return filesRepository.create(userId, {
            id,
            originalName: input.originalName,
            mimeType: input.mimeType,
            size: input.size,
            sha256,
            bucket,
            objectKey,
        });
    }
    async getMeta(userId, id) {
        const record = await filesRepository.findById(userId, id);
        if (!record)
            throw new NotFoundError('File', id);
        return record;
    }
    async download(userId, id, range) {
        const { client } = getS3Client();
        const meta = await this.getMeta(userId, id);
        const rangeHeader = range === null ? undefined : `bytes=${range.start}-${range.end !== undefined ? range.end : ''}`;
        const res = await client
            .send(new GetObjectCommand({
            Bucket: meta.bucket,
            Key: meta.objectKey,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
        }))
            .catch((error) => {
            // MinIO/S3 returns 404 with NoSuchKey when object is missing.
            throw new AppError(404, 'NOT_FOUND', error.message);
        });
        return {
            meta,
            body: res.Body,
            contentLength: res.ContentLength,
            contentRange: res.ContentRange,
        };
    }
    async downloadBuffer(userId, id, options) {
        const maxBytes = options?.maxBytes && Number.isFinite(options.maxBytes) && options.maxBytes > 0
            ? options.maxBytes
            : DEFAULT_BUFFER_DOWNLOAD_MAX_BYTES;
        const { meta, body } = await this.download(userId, id, null);
        if (meta.size > maxBytes) {
            throw new AppError(413, 'VALIDATION_ERROR', `File exceeds size limit (${maxBytes} bytes)`);
        }
        if (!body) {
            throw new AppError(500, 'INTERNAL_ERROR', 'Missing file body from storage');
        }
        const stream = toNodeReadable(body);
        const chunks = [];
        let total = 0;
        for await (const chunk of stream) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > maxBytes) {
                stream.destroy();
                throw new AppError(413, 'VALIDATION_ERROR', `File exceeds size limit (${maxBytes} bytes)`);
            }
            chunks.push(buf);
        }
        return {
            meta,
            buffer: Buffer.concat(chunks),
        };
    }
}
export const filesService = new FilesService();
//# sourceMappingURL=files.service.js.map