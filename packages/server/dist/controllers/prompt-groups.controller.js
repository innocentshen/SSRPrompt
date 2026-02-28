import { z } from 'zod';
import { promptGroupsService } from '../services/prompt-groups.service.js';
import { CreatePromptGroupSchema, UpdatePromptGroupSchema } from '@ssrprompt/shared';
export class PromptGroupsController {
    /**
     * GET /prompt-groups
     * List all groups for the authenticated user
     */
    async list(req, res, next) {
        try {
            const userId = req.user.userId;
            const groups = await promptGroupsService.findAll(userId);
            res.json({ data: groups });
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * POST /prompt-groups
     * Create a new group
     */
    async create(req, res, next) {
        try {
            const userId = req.user.userId;
            const input = CreatePromptGroupSchema.parse(req.body);
            const group = await promptGroupsService.create(userId, input);
            res.status(201).json({ data: group });
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * PUT /prompt-groups/:id
     * Update a group
     */
    async update(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
            const input = UpdatePromptGroupSchema.parse(req.body);
            const group = await promptGroupsService.update(userId, id, input);
            res.json({ data: group });
        }
        catch (error) {
            next(error);
        }
    }
    /**
     * DELETE /prompt-groups/:id
     * Delete a group
     */
    async delete(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
            await promptGroupsService.delete(userId, id);
            res.status(204).send();
        }
        catch (error) {
            next(error);
        }
    }
}
export const promptGroupsController = new PromptGroupsController();
//# sourceMappingURL=prompt-groups.controller.js.map