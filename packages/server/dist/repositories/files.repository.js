import { prisma } from '../config/database.js';
import { transformResponse } from '../utils/transform.js';
import { TenantRepository } from './base.repository.js';
export class FilesRepository extends TenantRepository {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "delegate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma.storedFile
        });
        Object.defineProperty(this, "entityName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'File'
        });
    }
    async create(userId, data) {
        const record = await this.delegate.create({
            data: {
                ...data,
                user: { connect: { id: userId } },
            },
        });
        return transformResponse(record);
    }
    async findById(userId, id) {
        const record = await super.findById(userId, id);
        return record ? transformResponse(record) : null;
    }
}
export const filesRepository = new FilesRepository();
//# sourceMappingURL=files.repository.js.map