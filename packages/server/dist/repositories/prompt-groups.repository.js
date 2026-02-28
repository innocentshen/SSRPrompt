import { TenantRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse } from '../utils/transform.js';
export class PromptGroupsRepository extends TenantRepository {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "delegate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma.promptGroup
        });
        Object.defineProperty(this, "entityName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'PromptGroup'
        });
    }
    /**
     * Find all prompt groups for a user (flat list)
     */
    async findAllList(userId) {
        const groups = await this.delegate.findMany({
            where: { userId },
            orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        });
        return groups.map(transformResponse);
    }
    /**
     * Find group by ID with ownership verification
     */
    async findById(userId, id) {
        const group = await super.findById(userId, id);
        return group ? transformResponse(group) : null;
    }
    /**
     * Create a prompt group
     */
    async create(userId, data) {
        const group = await this.delegate.create({
            data: {
                ...data,
                user: { connect: { id: userId } },
            },
        });
        return transformResponse(group);
    }
    /**
     * Update a prompt group
     */
    async update(userId, id, data) {
        await this.findByIdOrThrow(userId, id);
        const group = await this.delegate.update({
            where: { id },
            data,
        });
        return transformResponse(group);
    }
    /**
     * Delete a prompt group
     */
    async delete(userId, id) {
        await this.findByIdOrThrow(userId, id);
        const group = await this.delegate.delete({ where: { id } });
        return transformResponse(group);
    }
}
export const promptGroupsRepository = new PromptGroupsRepository();
//# sourceMappingURL=prompt-groups.repository.js.map