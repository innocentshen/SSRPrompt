import { prisma } from '../config/database.js';
import { promptGroupsRepository } from '../repositories/prompt-groups.repository.js';
import { NotFoundError, ValidationError } from '@ssrprompt/shared';
const MAX_GROUP_DEPTH = 3;
const normalizeName = (name) => name.trim();
const buildGroupIndex = (groups) => {
    const byId = new Map();
    const childrenByParent = new Map();
    for (const g of groups) {
        byId.set(g.id, g);
        const parentKey = g.parentId ?? null;
        const list = childrenByParent.get(parentKey) ?? [];
        list.push(g.id);
        childrenByParent.set(parentKey, list);
    }
    return { byId, childrenByParent };
};
const getDepth = (id, byId, memo, visiting) => {
    const cached = memo.get(id);
    if (typeof cached === 'number')
        return cached;
    if (visiting.has(id)) {
        throw new ValidationError('Invalid group hierarchy (cycle detected)');
    }
    const node = byId.get(id);
    if (!node) {
        throw new NotFoundError('PromptGroup', id);
    }
    visiting.add(id);
    const depth = node.parentId ? getDepth(node.parentId, byId, memo, visiting) + 1 : 1;
    visiting.delete(id);
    memo.set(id, depth);
    return depth;
};
const getHeight = (id, childrenByParent, memo, visiting) => {
    const cached = memo.get(id);
    if (typeof cached === 'number')
        return cached;
    if (visiting.has(id)) {
        throw new ValidationError('Invalid group hierarchy (cycle detected)');
    }
    visiting.add(id);
    const children = childrenByParent.get(id) ?? [];
    let maxChildHeight = 0;
    for (const childId of children) {
        maxChildHeight = Math.max(maxChildHeight, getHeight(childId, childrenByParent, memo, visiting));
    }
    visiting.delete(id);
    const height = 1 + maxChildHeight;
    memo.set(id, height);
    return height;
};
const assertWithinMaxDepth = (depth, height) => {
    const maxDepth = depth + height - 1;
    if (maxDepth > MAX_GROUP_DEPTH) {
        throw new ValidationError(`Prompt groups support up to ${MAX_GROUP_DEPTH} levels`);
    }
};
export class PromptGroupsService {
    /**
     * GET /prompt-groups
     * List all groups (flat list)
     */
    async findAll(userId) {
        return promptGroupsRepository.findAllList(userId);
    }
    /**
     * POST /prompt-groups
     * Create a group (max 3 levels)
     */
    async create(userId, data) {
        const name = normalizeName(data.name);
        if (!name)
            throw new ValidationError('Group name is required');
        const parentId = data.parentId ?? null;
        if (parentId) {
            await this.assertGroupExists(userId, parentId);
            await this.assertNewChildDepthAllowed(userId, parentId);
        }
        const createData = {
            name,
            orderIndex: data.orderIndex ?? 0,
            ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
        };
        return promptGroupsRepository.create(userId, createData);
    }
    /**
     * PUT /prompt-groups/:id
     * Update group name / parent / orderIndex (max 3 levels)
     */
    async update(userId, id, data) {
        const existing = await promptGroupsRepository.findById(userId, id);
        if (!existing)
            throw new NotFoundError('PromptGroup', id);
        const updateData = {};
        if (typeof data.name !== 'undefined') {
            const nextName = normalizeName(data.name);
            if (!nextName)
                throw new ValidationError('Group name is required');
            updateData.name = nextName;
        }
        if (typeof data.orderIndex !== 'undefined') {
            updateData.orderIndex = data.orderIndex;
        }
        if (typeof data.parentId !== 'undefined') {
            const nextParentId = data.parentId ?? null;
            if (nextParentId === id) {
                throw new ValidationError('A group cannot be its own parent');
            }
            if (nextParentId) {
                await this.assertGroupExists(userId, nextParentId);
                await this.assertReparentAllowed(userId, id, nextParentId);
                updateData.parent = { connect: { id: nextParentId } };
            }
            else {
                updateData.parent = { disconnect: true };
            }
        }
        return promptGroupsRepository.update(userId, id, updateData);
    }
    /**
     * DELETE /prompt-groups/:id
     * Delete a group safely (detach prompts and children)
     */
    async delete(userId, id) {
        await promptGroupsRepository.findByIdOrThrow(userId, id);
        await prisma.$transaction([
            prisma.prompt.updateMany({
                where: { userId, groupId: id },
                data: { groupId: null },
            }),
            prisma.promptGroup.updateMany({
                where: { userId, parentId: id },
                data: { parentId: null },
            }),
            prisma.promptGroup.deleteMany({
                where: { userId, id },
            }),
        ]);
    }
    async assertGroupExists(userId, id) {
        const group = await prisma.promptGroup.findFirst({
            where: { id, userId },
            select: { id: true, parentId: true },
        });
        if (!group)
            throw new NotFoundError('PromptGroup', id);
        return group;
    }
    async assertNewChildDepthAllowed(userId, parentId) {
        // Validate depth by walking up parents (max 3 levels total).
        const visited = new Set();
        let depth = 1;
        let current = parentId;
        while (current) {
            if (visited.has(current)) {
                throw new ValidationError('Invalid group hierarchy (cycle detected)');
            }
            visited.add(current);
            depth += 1;
            if (depth > MAX_GROUP_DEPTH) {
                throw new ValidationError(`Prompt groups support up to ${MAX_GROUP_DEPTH} levels`);
            }
            const parent = await prisma.promptGroup.findFirst({
                where: { id: current, userId },
                select: { parentId: true },
            });
            if (!parent)
                throw new NotFoundError('PromptGroup', current);
            current = parent.parentId;
        }
    }
    async assertReparentAllowed(userId, groupId, newParentId) {
        // Load all groups for the user once and validate:
        // 1) No cycle (new parent can't be within subtree)
        // 2) Depth constraint for the moved subtree (max 3 levels total)
        const groups = await prisma.promptGroup.findMany({
            where: { userId },
            select: { id: true, parentId: true },
        });
        const { byId, childrenByParent } = buildGroupIndex(groups);
        if (!byId.has(groupId))
            throw new NotFoundError('PromptGroup', groupId);
        // Cycle check: walk ancestors of newParentId and ensure we never hit groupId
        const seen = new Set();
        let current = newParentId;
        while (current) {
            if (seen.has(current)) {
                throw new ValidationError('Invalid group hierarchy (cycle detected)');
            }
            if (current === groupId) {
                throw new ValidationError('A group cannot be moved into its own subtree');
            }
            seen.add(current);
            current = byId.get(current)?.parentId ?? null;
        }
        const depthMemo = new Map();
        const heightMemo = new Map();
        const newParentDepth = getDepth(newParentId, byId, depthMemo, new Set());
        const newGroupDepth = newParentDepth + 1;
        const subtreeHeight = getHeight(groupId, childrenByParent, heightMemo, new Set());
        assertWithinMaxDepth(newGroupDepth, subtreeHeight);
    }
}
export const promptGroupsService = new PromptGroupsService();
//# sourceMappingURL=prompt-groups.service.js.map