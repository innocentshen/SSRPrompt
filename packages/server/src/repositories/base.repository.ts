import { PrismaClient } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '@ssrprompt/shared';
import { prisma } from '../config/database.js';

/**
 * Base repository with tenant isolation
 * All methods require userId for data isolation
 */
export abstract class TenantRepository<
  TModel,
  TCreateInput,
  TUpdateInput,
  TDelegate extends {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
    count: (args: unknown) => Promise<number>;
  }
> {
  protected prisma: PrismaClient = prisma;
  protected abstract delegate: TDelegate;
  protected abstract entityName: string;

  /**
   * Find all records for a user
   */
  async findAll(
    userId: string,
    options?: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
      skip?: number;
      take?: number;
      select?: Record<string, boolean>;
    }
  ): Promise<TModel[]> {
    return this.delegate.findMany({
      where: { userId, ...options?.where },
      orderBy: options?.orderBy,
      skip: options?.skip,
      take: options?.take,
      select: options?.select,
    }) as Promise<TModel[]>;
  }

  /**
   * Find a single record by ID with ownership verification
   */
  async findById(userId: string, id: string): Promise<TModel | null> {
    const record = (await this.delegate.findUnique({
      where: { id },
    })) as (TModel & { userId?: string }) | null;

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
  async findByIdOrThrow(userId: string, id: string): Promise<TModel> {
    const record = await this.findById(userId, id);
    if (!record) {
      throw new NotFoundError(this.entityName, id);
    }
    return record;
  }

  /**
   * Create a new record
   */
  async create(userId: string, data: TCreateInput): Promise<TModel> {
    return this.delegate.create({
      data: { ...data, userId },
    }) as Promise<TModel>;
  }

  /**
   * Update a record with ownership verification
   */
  async update(userId: string, id: string, data: TUpdateInput): Promise<TModel> {
    // First verify ownership
    await this.findByIdOrThrow(userId, id);

    return this.delegate.update({
      where: { id },
      data,
    }) as Promise<TModel>;
  }

  /**
   * Delete a record with ownership verification
   */
  async delete(userId: string, id: string): Promise<TModel> {
    // First verify ownership
    await this.findByIdOrThrow(userId, id);

    return this.delegate.delete({
      where: { id },
    }) as Promise<TModel>;
  }

  /**
   * Count records for a user
   */
  async count(userId: string, where?: Record<string, unknown>): Promise<number> {
    return this.delegate.count({
      where: { userId, ...where },
    });
  }
}

/**
 * Base repository for entities without userId (child entities)
 */
export abstract class ChildRepository<
  TModel,
  TCreateInput,
  TUpdateInput,
  TDelegate extends {
    findMany: (args: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  }
> {
  protected prisma: PrismaClient = prisma;
  protected abstract delegate: TDelegate;
  protected abstract entityName: string;
  protected abstract parentField: string;

  /**
   * Find all records for a parent entity
   */
  async findByParent(
    parentId: string,
    options?: {
      orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
      select?: Record<string, boolean>;
    }
  ): Promise<TModel[]> {
    return this.delegate.findMany({
      where: { [this.parentField]: parentId },
      orderBy: options?.orderBy,
      select: options?.select,
    }) as Promise<TModel[]>;
  }

  /**
   * Find a single record by ID
   */
  async findById(id: string): Promise<TModel | null> {
    return this.delegate.findUnique({
      where: { id },
    }) as Promise<TModel | null>;
  }

  /**
   * Find a single record by ID, throwing if not found
   */
  async findByIdOrThrow(id: string): Promise<TModel> {
    const record = await this.findById(id);
    if (!record) {
      throw new NotFoundError(this.entityName, id);
    }
    return record;
  }

  /**
   * Create a new record
   */
  async create(parentId: string, data: TCreateInput): Promise<TModel> {
    return this.delegate.create({
      data: { ...data, [this.parentField]: parentId },
    }) as Promise<TModel>;
  }

  /**
   * Update a record
   */
  async update(id: string, data: TUpdateInput): Promise<TModel> {
    return this.delegate.update({
      where: { id },
      data,
    }) as Promise<TModel>;
  }

  /**
   * Delete a record
   */
  async delete(id: string): Promise<TModel> {
    return this.delegate.delete({
      where: { id },
    }) as Promise<TModel>;
  }
}
