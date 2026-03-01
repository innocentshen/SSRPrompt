import { z } from 'zod';
import { AppError, VerifySharePasswordSchema } from '@ssrprompt/shared';
import { shareLinksService } from '../services/share-links.service.js';
import { toNodeReadable } from '../utils/stream.js';
const CopyFromShareSchema = z.object({
    name: z.string().min(1).max(200).optional(),
});
function parseRangeHeader(rangeHeader) {
    if (!rangeHeader)
        return null;
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
function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        const first = forwarded.split(',')[0]?.trim();
        if (first)
            return first;
    }
    return req.ip || null;
}
function getAccessContext(req) {
    return {
        ipAddress: getRequestIp(req),
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    };
}
export const shareController = {
    async verifyPassword(req, res) {
        const input = VerifySharePasswordSchema.parse(req.body);
        await shareLinksService.verifyPassword(req.user.userId, req.params.token, input.password, getAccessContext(req));
        res.json({ data: { success: true } });
    },
    async getPrompt(req, res) {
        const detail = await shareLinksService.getSharedPrompt(req.user.userId, req.params.token, getAccessContext(req));
        res.json({ data: detail });
    },
    async getEvaluation(req, res) {
        const detail = await shareLinksService.getSharedEvaluation(req.user.userId, req.params.token, getAccessContext(req));
        res.json({ data: detail });
    },
    async copyPrompt(req, res) {
        const input = CopyFromShareSchema.parse(req.body ?? {});
        const copied = await shareLinksService.copySharedPrompt(req.user.userId, req.params.token, input.name, getAccessContext(req));
        res.status(201).json({ data: copied });
    },
    async copyEvaluation(req, res) {
        const input = CopyFromShareSchema.parse(req.body ?? {});
        const copied = await shareLinksService.copySharedEvaluation(req.user.userId, req.params.token, input.name, getAccessContext(req));
        res.status(201).json({ data: copied });
    },
    async downloadEvaluationAttachment(req, res) {
        const range = parseRangeHeader(typeof req.headers.range === 'string' ? req.headers.range : undefined);
        const { meta, body, contentLength, contentRange } = await shareLinksService.downloadSharedEvaluationAttachment(req.user.userId, req.params.token, req.params.fileId, range, getAccessContext(req));
        res.setHeader('Content-Type', meta.mimeType);
        res.setHeader('Accept-Ranges', 'bytes');
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
        stream.pipe(res);
    },
};
//# sourceMappingURL=share.controller.js.map