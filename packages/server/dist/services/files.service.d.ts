import type { StoredFile } from '@prisma/client';
export type UploadFileInput = {
    originalName: string;
    mimeType: string;
    size: number;
    buffer: Buffer;
};
export type DownloadRange = {
    start: number;
    end?: number;
} | null;
export declare class FilesService {
    upload(userId: string, input: UploadFileInput): Promise<StoredFile>;
    getMeta(userId: string, id: string): Promise<StoredFile>;
    download(userId: string, id: string, range: DownloadRange): Promise<{
        meta: StoredFile;
        body: unknown;
        contentLength?: number;
        contentRange?: string;
    }>;
    downloadBuffer(userId: string, id: string): Promise<{
        meta: StoredFile;
        buffer: Buffer;
    }>;
}
export declare const filesService: FilesService;
//# sourceMappingURL=files.service.d.ts.map