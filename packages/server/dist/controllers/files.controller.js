import { AppError } from '@ssrprompt/shared';
import { filesService } from '../services/files.service.js';
import { toNodeReadable } from '../utils/stream.js';
function parseRangeHeader(rangeHeader) {
    if (!rangeHeader)
        return null;
    // Only support single range: bytes=start-end
    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
    if (!match)
        return null;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : undefined;
    if (!Number.isFinite(start) || start < 0)
        return null;
    if (end !== undefined && (!Number.isFinite(end) || end < start))
        return null;
    return { start, end };
}
export class FilesController {
    /**
     * POST /files
     * Upload a file and store in S3-compatible storage (e.g., MinIO)
     */
    async upload(req, res, next) {
        try {
            const userId = req.user.userId;
            const file = req.file;
            if (!file) {
                throw new AppError(400, 'VALIDATION_ERROR', 'Missing file');
            }
            const record = await filesService.upload(userId, {
                // multer uses latin1 for originalname, decode as UTF-8
                originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
                mimeType: file.mimetype,
                size: file.size,
                buffer: file.buffer,
            });
            res.status(201).json({
                data: {
                    id: record.id,
                    name: record.originalName,
                    type: record.mimeType,
                    size: record.size,
                    createdAt: record.createdAt,
                },
            });
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * GET /files/:id/meta
     * Get file metadata
     */
    async getMeta(req, res, next) {
        try {
            const userId = req.user.userId;
            const record = await filesService.getMeta(userId, req.params.id);
            res.json({
                data: {
                    id: record.id,
                    name: record.originalName,
                    type: record.mimeType,
                    size: record.size,
                    createdAt: record.createdAt,
                },
            });
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * GET /files/:id
     * Download/preview a file (supports Range)
     */
    async download(req, res, next) {
        try {
            const userId = req.user.userId;
            const range = parseRangeHeader(req.headers.range);
            const { meta, body, contentLength, contentRange } = await filesService.download(userId, req.params.id, range);
            res.setHeader('Content-Type', meta.mimeType);
            res.setHeader('Accept-Ranges', 'bytes');
            // Use RFC 5987 encoding for non-ASCII filenames
            const safeFilename = meta.originalName.replace(/[^\x20-\x7E]/g, '');
            const encodedFilename = encodeURIComponent(meta.originalName);
            res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
            if (range && contentRange) {
                res.status(206);
                res.setHeader('Content-Range', contentRange);
            }
            if (contentLength !== undefined) {
                res.setHeader('Content-Length', String(contentLength));
            }
            else if (!range) {
                res.setHeader('Content-Length', String(meta.size));
            }
            if (!body) {
                throw new AppError(500, 'INTERNAL_ERROR', 'Missing file body from storage');
            }
            const stream = toNodeReadable(body);
            stream.on('error', (err) => {
                next(err);
            });
            stream.pipe(res);
        }
        catch (error) {
            next(error);
        }
    }
}
export const filesController = new FilesController();
//# sourceMappingURL=files.controller.js.map