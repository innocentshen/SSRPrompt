import { Prompt, PromptVersion, Prisma } from '@prisma/client';
import { TenantRepository, ChildRepository } from './base.repository.js';
import { prisma } from '../config/database.js';
import { transformResponse } from '../utils/transform.js';

type PromptDelegate = typeof prisma.prompt;
type VersionDelegate = typeof prisma.promptVersion;

export class PromptsRepository extends TenantRepository<
  Prompt,
  Prisma.PromptCreateInput,
  Prisma.PromptUpdateInput,
  PromptDelegate
> {
  protected delegate = prisma.prompt;
  protected entityName = 'Prompt';

  /**
   * Find all prompts for a user (list view - exclude large fields)
   */
  async findAllList(userId: string): Promise<Partial<Prompt>[]> {
    // CRITICAL: Validate userId to prevent security bypass
    if (!userId || typeof userId !== 'string') {
      throw new Error('userId is required for prompts query');
    }

    const prompts = await this.delegate.findMany({
      where: {
        userId: userId,
      },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        currentVersion: true,
        defaultModelId: true,
        groupId: true,
        orderIndex: true,
        apiEnabled: true,
        apiVersionMode: true,
        apiFixedVersion: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ orderIndex: 'asc' }, { updatedAt: 'desc' }],
    });

    return prompts.map(transformResponse);
  }

  /**
   * Create a prompt
   */
  async create(userId: string, data: Omit<Prisma.PromptCreateInput, 'userId' | 'user'>): Promise<Prompt> {
    const prompt = await this.delegate.create({
      data: { ...data, user: { connect: { id: userId } } },
    });

    return transformResponse(prompt);
  }

  /**
   * Update prompt order for multiple prompts
   */
  async updateOrder(userId: string, updates: { id: string; orderIndex: number }[]): Promise<void> {
    await prisma.$transaction(
      updates.map((u) =>
        this.delegate.updateMany({
          where: { id: u.id, userId },
          data: { orderIndex: u.orderIndex },
        })
      )
    );
  }

  /**
   * Get next version number for a prompt
   */
  async getNextVersion(promptId: string): Promise<number> {
    const prompt = await this.delegate.findUnique({
      where: { id: promptId },
      select: { currentVersion: true },
    });

    return (prompt?.currentVersion ?? 0) + 1;
  }
}

export class PromptVersionsRepository extends ChildRepository<
  PromptVersion,
  Prisma.PromptVersionCreateInput,
  Prisma.PromptVersionUpdateInput,
  VersionDelegate
> {
  protected delegate = prisma.promptVersion;
  protected entityName = 'PromptVersion';
  protected parentField = 'promptId';

  /**
   * Find all versions for a prompt
   */
  async findByPrompt(promptId: string): Promise<PromptVersion[]> {
    const versions = await this.delegate.findMany({
      where: { promptId },
      orderBy: { version: 'desc' },
    });

    return versions.map(transformResponse);
  }

  /**
   * Create a new version and update prompt's current version
   */
  async createVersion(
    promptId: string,
    version: number,
    data: {
      content: string;
      commitMessage?: string;
      variables?: Prisma.InputJsonValue;
      messages?: Prisma.InputJsonValue;
      config?: Prisma.InputJsonValue;
      defaultModelId?: string | null;
      isPublic?: boolean;
      publishedAt?: Date | null;
    }
  ): Promise<PromptVersion> {
    const [versionRecord] = await prisma.$transaction([
      this.delegate.create({
        data: {
          promptId,
          version,
          content: data.content,
          commitMessage: data.commitMessage,
          variables: data.variables ?? [],
          messages: data.messages ?? [],
          config: data.config ?? {},
          defaultModelId: data.defaultModelId ?? null,
          isPublic: data.isPublic ?? false,
          publishedAt: data.publishedAt ?? null,
        },
      }),
      prisma.prompt.update({
        where: { id: promptId },
        data: { currentVersion: version },
      }),
    ]);

    return transformResponse(versionRecord);
  }

  /**
   * Find a specific version
   */
  async findByVersion(promptId: string, version: number): Promise<PromptVersion | null> {
    const record = await this.delegate.findUnique({
      where: {
        promptId_version: { promptId, version },
      },
    });

    return record ? transformResponse(record) : null;
  }
}

export const promptsRepository = new PromptsRepository();
export const promptVersionsRepository = new PromptVersionsRepository();
