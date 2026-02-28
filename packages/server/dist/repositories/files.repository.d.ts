import { Prisma, StoredFile } from '@prisma/client';
import { prisma } from '../config/database.js';
import { TenantRepository } from './base.repository.js';
type StoredFileDelegate = typeof prisma.storedFile;
export declare class FilesRepository extends TenantRepository<StoredFile, Prisma.StoredFileCreateInput, Prisma.StoredFileUpdateInput, StoredFileDelegate> {
    protected delegate: Prisma.StoredFileDelegate<import("@prisma/client/runtime/library").DefaultArgs>;
    protected entityName: string;
    create(userId: string, data: Omit<Prisma.StoredFileCreateInput, 'user'>): Promise<StoredFile>;
    findById(userId: string, id: string): Promise<StoredFile | null>;
}
export declare const filesRepository: FilesRepository;
export {};
//# sourceMappingURL=files.repository.d.ts.map