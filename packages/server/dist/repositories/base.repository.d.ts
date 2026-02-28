import { PrismaClient } from '@prisma/client';
type PrismaDelegate = {
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any | null>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    delete: (args: any) => Promise<any>;
    count?: (args: any) => Promise<number>;
};
export interface FindOptions {
    where?: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
    skip?: number;
    take?: number;
    select?: Record<string, boolean>;
    include?: Record<string, boolean | object>;
}
/**
 * Base repository with tenant isolation
 * All methods require userId for data isolation
 */
export declare abstract class TenantRepository<TModel, TCreateInput, TUpdateInput, TDelegate extends PrismaDelegate = PrismaDelegate> {
    protected prisma: PrismaClient;
    protected abstract delegate: TDelegate;
    protected abstract entityName: string;
    /**
     * Find all records for a user
     */
    findAll(userId: string, options?: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
        skip?: number;
        take?: number;
        select?: Record<string, boolean>;
    }): Promise<TModel[]>;
    /**
     * Find a single record by ID with ownership verification
     */
    findById(userId: string, id: string): Promise<TModel | null>;
    /**
     * Find a single record by ID, throwing if not found
     */
    findByIdOrThrow(userId: string, id: string): Promise<TModel>;
    /**
     * Create a new record
     */
    create(userId: string, data: TCreateInput): Promise<TModel>;
    /**
     * Update a record with ownership verification
     */
    update(userId: string, id: string, data: TUpdateInput): Promise<TModel>;
    /**
     * Delete a record with ownership verification
     */
    delete(userId: string, id: string): Promise<TModel>;
    /**
     * Count records for a user
     */
    count(userId: string, where?: Record<string, unknown>): Promise<number>;
}
/**
 * Base repository for entities without userId (child entities)
 */
export declare abstract class ChildRepository<TModel, TCreateInput, TUpdateInput, TDelegate extends PrismaDelegate = PrismaDelegate> {
    protected prisma: PrismaClient;
    protected abstract delegate: TDelegate;
    protected abstract entityName: string;
    protected abstract parentField: string;
    /**
     * Find all records for a parent entity
     */
    findByParent(parentId: string, options?: {
        orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
        select?: Record<string, boolean>;
    }): Promise<TModel[]>;
    /**
     * Find a single record by ID
     */
    findById(id: string): Promise<TModel | null>;
    /**
     * Find a single record by ID, throwing if not found
     */
    findByIdOrThrow(id: string): Promise<TModel>;
    /**
     * Create a new record
     */
    create(parentId: string, data: TCreateInput): Promise<TModel>;
    /**
     * Update a record
     */
    update(id: string, data: TUpdateInput): Promise<TModel>;
    /**
     * Delete a record
     */
    delete(id: string): Promise<TModel>;
}
export {};
//# sourceMappingURL=base.repository.d.ts.map