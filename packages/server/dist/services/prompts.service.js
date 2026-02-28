import { promptsRepository, promptVersionsRepository } from '../repositories/prompts.repository.js';
import { prisma } from '../config/database.js';
import { NotFoundError } from '@ssrprompt/shared';
export class PromptsService {
    /**
     * Get all prompts for a user (list view)
     */
    async findAll(userId) {
        return promptsRepository.findAllList(userId);
    }
    /**
     * Get prompt by ID with full details
     */
    async findById(userId, id) {
        return promptsRepository.findById(userId, id);
    }
    /**
     * Create a new prompt
     */
    async create(userId, data) {
        const groupId = data.groupId ?? null;
        if (groupId) {
            await this.assertPromptGroupExists(userId, groupId);
        }
        return promptsRepository.create(userId, {
            name: data.name,
            description: data.description,
            content: data.content,
            variables: data.variables ?? [],
            messages: data.messages ?? [],
            config: (data.config ?? {}),
            defaultModel: data.defaultModelId ? { connect: { id: data.defaultModelId } } : undefined,
            ...(groupId ? { group: { connect: { id: groupId } } } : {}),
        });
    }
    /**
     * Update a prompt
     * When setting isPublic to false, cascade to related evaluations
     */
    async update(userId, id, data) {
        const updateData = {
            ...data,
            config: data.config ? data.config : undefined,
        };
        const groupId = data.groupId;
        if (typeof groupId !== 'undefined') {
            if (groupId) {
                await this.assertPromptGroupExists(userId, groupId);
                updateData.group = { connect: { id: groupId } };
            }
            else {
                updateData.group = { disconnect: true };
            }
            delete updateData.groupId;
        }
        // If setting prompt to private, also set related evaluations to private
        if (data.isPublic === false) {
            await prisma.evaluation.updateMany({
                where: { promptId: id, isPublic: true },
                data: { isPublic: false },
            });
            // Unpublish all prompt versions
            await prisma.promptVersion.updateMany({
                where: { promptId: id, isPublic: true },
                data: { isPublic: false },
            });
        }
        const updatedPrompt = await promptsRepository.update(userId, id, updateData);
        // If setting prompt to public, ensure a published version snapshot exists
        if (data.isPublic === true) {
            const existing = await prisma.promptVersion.findUnique({
                where: { promptId_version: { promptId: id, version: updatedPrompt.currentVersion } },
            });
            if (!existing) {
                // Create a snapshot for the currentVersion if it doesn't exist yet
                await promptVersionsRepository.createVersion(id, updatedPrompt.currentVersion, {
                    content: updatedPrompt.content ?? '',
                    commitMessage: `Publish v${updatedPrompt.currentVersion}`,
                    variables: updatedPrompt.variables,
                    messages: updatedPrompt.messages,
                    config: updatedPrompt.config,
                    defaultModelId: updatedPrompt.defaultModelId,
                    isPublic: true,
                    publishedAt: new Date(),
                });
            }
            else if (!existing.isPublic) {
                await prisma.promptVersion.update({
                    where: { id: existing.id },
                    data: { isPublic: true, publishedAt: existing.publishedAt ?? new Date() },
                });
            }
            // Ensure older versions remain accessible while public
            await prisma.promptVersion.updateMany({
                where: { promptId: id },
                data: { isPublic: true },
            });
        }
        return updatedPrompt;
    }
    async assertPromptGroupExists(userId, groupId) {
        const group = await prisma.promptGroup.findFirst({
            where: { id: groupId, userId },
            select: { id: true },
        });
        if (!group) {
            throw new NotFoundError('PromptGroup', groupId);
        }
    }
    /**
     * Delete a prompt
     */
    async delete(userId, id) {
        return promptsRepository.delete(userId, id);
    }
    /**
     * Update order of multiple prompts
     */
    async updateOrder(userId, updates) {
        return promptsRepository.updateOrder(userId, updates);
    }
    /**
     * Get versions for a prompt
     */
    async getVersions(userId, promptId) {
        // Verify ownership
        await promptsRepository.findByIdOrThrow(userId, promptId);
        return promptVersionsRepository.findByPrompt(promptId);
    }
    /**
     * Create a new version
     */
    async createVersion(userId, promptId, data) {
        // Verify ownership & get current prompt state for snapshot defaults
        const prompt = await promptsRepository.findByIdOrThrow(userId, promptId);
        const nextVersion = await promptsRepository.getNextVersion(promptId);
        return promptVersionsRepository.createVersion(promptId, nextVersion, {
            content: data.content,
            commitMessage: data.commitMessage,
            variables: (data.variables ?? prompt.variables),
            messages: (data.messages ?? prompt.messages),
            config: (data.config ?? prompt.config),
            defaultModelId: data.defaultModelId ?? prompt.defaultModelId,
            isPublic: prompt.isPublic,
            publishedAt: prompt.isPublic ? new Date() : null,
        });
    }
    /**
     * Get a specific version
     */
    async getVersion(userId, promptId, version) {
        // Verify ownership
        await promptsRepository.findByIdOrThrow(userId, promptId);
        return promptVersionsRepository.findByVersion(promptId, version);
    }
    // ============ Public Prompt Plaza ============
    /**
     * List all public prompts for the plaza (one item per prompt)
     */
    async listPublicPrompts() {
        const prompts = await prisma.prompt.findMany({
            where: { isPublic: true },
            select: {
                id: true,
                name: true,
                description: true,
                currentVersion: true,
                createdAt: true,
                updatedAt: true,
                user: {
                    select: { id: true, name: true, avatar: true },
                },
                defaultModel: {
                    select: {
                        name: true,
                        modelId: true,
                        provider: {
                            select: { type: true },
                        },
                    },
                },
            },
            orderBy: { updatedAt: 'desc' },
        });
        return prompts.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description ?? null,
            publicVersion: p.currentVersion,
            author: {
                id: p.user?.id ?? 'unknown',
                name: p.user?.name ?? null,
                avatar: p.user?.avatar ?? null,
            },
            defaultModel: p.defaultModel
                ? {
                    providerType: p.defaultModel.provider.type,
                    modelId: p.defaultModel.modelId,
                    name: p.defaultModel.name,
                }
                : null,
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
        }));
    }
    /**
     * Get public prompt detail (latest public version snapshot)
     */
    async getPublicPrompt(promptId) {
        const prompt = await prisma.prompt.findFirst({
            where: { id: promptId, isPublic: true },
            select: {
                id: true,
                name: true,
                description: true,
                currentVersion: true,
                createdAt: true,
                updatedAt: true,
                user: { select: { id: true, name: true, avatar: true } },
                defaultModel: {
                    select: {
                        name: true,
                        modelId: true,
                        provider: { select: { type: true } },
                    },
                },
            },
        });
        if (!prompt)
            return null;
        const latestPublicVersion = await prisma.promptVersion.findFirst({
            where: { promptId, isPublic: true },
            orderBy: { version: 'desc' },
        });
        // Fallback: if version snapshots are missing, use currentVersion if present, else empty
        const versionData = latestPublicVersion ?? (await prisma.promptVersion.findUnique({
            where: { promptId_version: { promptId, version: prompt.currentVersion } },
        }));
        return {
            id: prompt.id,
            name: prompt.name,
            description: prompt.description ?? null,
            publicVersion: versionData?.version ?? prompt.currentVersion,
            author: {
                id: prompt.user?.id ?? 'unknown',
                name: prompt.user?.name ?? null,
                avatar: prompt.user?.avatar ?? null,
            },
            defaultModel: prompt.defaultModel
                ? {
                    providerType: prompt.defaultModel.provider.type,
                    modelId: prompt.defaultModel.modelId,
                    name: prompt.defaultModel.name,
                }
                : null,
            createdAt: prompt.createdAt.toISOString(),
            updatedAt: prompt.updatedAt.toISOString(),
            content: versionData?.content ?? '',
            variables: (versionData?.variables ?? []),
            messages: (versionData?.messages ?? []),
            config: (versionData?.config ?? {}),
        };
    }
    /**
     * List public versions for a public prompt
     */
    async getPublicVersions(promptId) {
        const prompt = await prisma.prompt.findFirst({
            where: { id: promptId, isPublic: true },
            select: { id: true },
        });
        if (!prompt)
            throw new NotFoundError('Prompt', promptId);
        const publicVersions = await prisma.promptVersion.findMany({
            where: { promptId, isPublic: true },
            orderBy: { version: 'desc' },
        });
        // Backward compatibility: legacy rows may not have isPublic populated yet
        if (publicVersions.length > 0)
            return publicVersions;
        return prisma.promptVersion.findMany({
            where: { promptId },
            orderBy: { version: 'desc' },
        });
    }
    /**
     * Get a specific public version for a public prompt
     */
    async getPublicVersion(promptId, version) {
        const prompt = await prisma.prompt.findFirst({
            where: { id: promptId, isPublic: true },
            select: { id: true },
        });
        if (!prompt) {
            return null;
        }
        const v = await prisma.promptVersion.findUnique({
            where: { promptId_version: { promptId, version } },
        });
        if (!v)
            return null;
        if (v.isPublic)
            return v;
        // Backward compatibility: if no versions are marked public, allow access while prompt is public
        const anyPublic = await prisma.promptVersion.findFirst({
            where: { promptId, isPublic: true },
            select: { id: true },
        });
        return anyPublic ? null : v;
    }
    /**
     * Copy a public prompt version into the user's private space
     */
    async copyPublicPrompt(userId, promptId, input) {
        const prompt = await prisma.prompt.findFirst({
            where: { id: promptId, isPublic: true },
            select: {
                id: true,
                name: true,
                description: true,
                user: { select: { id: true, name: true } },
            },
        });
        if (!prompt)
            throw new NotFoundError('Prompt', promptId);
        const version = input.version
            ? await prisma.promptVersion.findFirst({
                where: { promptId, version: input.version, isPublic: true },
            })
            : await prisma.promptVersion.findFirst({
                where: { promptId, isPublic: true },
                orderBy: { version: 'desc' },
            });
        // Backward compatibility: legacy rows may not have isPublic populated yet
        const resolvedVersion = version ??
            (input.version
                ? await prisma.promptVersion.findFirst({ where: { promptId, version: input.version } })
                : await prisma.promptVersion.findFirst({ where: { promptId }, orderBy: { version: 'desc' } }));
        if (!resolvedVersion) {
            const id = input.version ? `${promptId}@v${input.version}` : `${promptId}@latest`;
            throw new NotFoundError('PromptVersion', id);
        }
        const newPrompt = await promptsRepository.create(userId, {
            name: input.name?.trim() || `${prompt.name} (Copy)`,
            description: prompt.description,
            content: resolvedVersion.content,
            variables: resolvedVersion.variables,
            messages: resolvedVersion.messages,
            config: resolvedVersion.config,
            defaultModel: undefined,
            isPublic: false,
        });
        // Create initial version snapshot for the copied prompt
        await promptVersionsRepository.createVersion(newPrompt.id, 1, {
            content: resolvedVersion.content,
            commitMessage: `Imported from ${prompt.user?.name || prompt.user?.id || 'unknown'}:${prompt.id} v${resolvedVersion.version}`,
            variables: resolvedVersion.variables,
            messages: resolvedVersion.messages,
            config: resolvedVersion.config,
            defaultModelId: null,
            isPublic: false,
            publishedAt: null,
        });
        return newPrompt;
    }
}
export const promptsService = new PromptsService();
//# sourceMappingURL=prompts.service.js.map