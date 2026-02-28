import { ForbiddenError, NotFoundError } from '@ssrprompt/shared';
import { prisma } from '../config/database.js';
/**
 * Base repository with tenant isolation
 * All methods require userId for data isolation
 */
export class TenantRepository {
    constructor() {
        Object.defineProperty(this, "prisma", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma
        });
    }
    /**
     * Find all records for a user
     */
    async findAll(userId, options) {
        // CRITICAL: Validate userId to prevent security bypass
        // If userId is undefined/null/empty, Prisma would ignore the condition,
        // causing the query to return ALL records (security vulnerability)
        if (!userId || typeof userId !== 'string') {
            throw new Error(`userId is required for ${this.entityName} query`);
        }
        return this.delegate.findMany({
            where: { userId: userId, ...options?.where },
            orderBy: options?.orderBy,
            skip: options?.skip,
            take: options?.take,
            select: options?.select,
        });
    }
    /**
     * Find a single record by ID with ownership verification
     */
    async findById(userId, id) {
        const record = (await this.delegate.findUnique({
            where: { id },
        }));
        if (!record) {
            return null;
        }
        // Verify ownership
        if (record.userId && record.userId !== userId) {
            throw new ForbiddenError(`Access denied to ${this.entityName}`);
        }
        return record;
    }
    /**
     * Find a single record by ID, throwing if not found
     */
    async findByIdOrThrow(userId, id) {
        const record = await this.findById(userId, id);
        if (!record) {
            throw new NotFoundError(this.entityName, id);
        }
        return record;
    }
    /**
     * Create a new record
     */
    async create(userId, data) {
        return this.delegate.create({
            data: { ...data, userId },
        });
    }
    /**
     * Update a record with ownership verification
     */
    async update(userId, id, data) {
        // First verify ownership
        await this.findByIdOrThrow(userId, id);
        return this.delegate.update({
            where: { id },
            data,
        });
    }
    /**
     * Delete a record with ownership verification
     */
    async delete(userId, id) {
        // First verify ownership
        await this.findByIdOrThrow(userId, id);
        return this.delegate.delete({
            where: { id },
        });
    }
    /**
     * Count records for a user
     */
    async count(userId, where) {
        // CRITICAL: Validate userId to prevent security bypass
        if (!userId || typeof userId !== 'string') {
            throw new Error(`userId is required for ${this.entityName} count`);
        }
        if (!this.delegate.count) {
            throw new Error(`Count not supported for ${this.entityName}`);
        }
        return this.delegate.count({
            where: { userId: userId, ...where },
        });
    }
}
/**
 * Base repository for entities without userId (child entities)
 */
export class ChildRepository {
    constructor() {
        Object.defineProperty(this, "prisma", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: prisma
        });
    }
    /**
     * Find all records for a parent entity
     */
    async findByParent(parentId, options) {
        return this.delegate.findMany({
            where: { [this.parentField]: parentId },
            orderBy: options?.orderBy,
            select: options?.select,
        });
    }
    /**
     * Find a single record by ID
     */
    async findById(id) {
        return this.delegate.findUnique({
            where: { id },
        });
    }
    /**
     * Find a single record by ID, throwing if not found
     */
    async findByIdOrThrow(id) {
        const record = await this.findById(id);
        if (!record) {
            throw new NotFoundError(this.entityName, id);
        }
        return record;
    }
    /**
     * Create a new record
     */
    async create(parentId, data) {
        return this.delegate.create({
            data: { ...data, [this.parentField]: parentId },
        });
    }
    /**
     * Update a record
     */
    async update(id, data) {
        return this.delegate.update({
            where: { id },
            data,
        });
    }
    /**
     * Delete a record
     */
    async delete(id) {
        return this.delegate.delete({
            where: { id },
        });
    }
}
//# sourceMappingURL=base.repository.js.map