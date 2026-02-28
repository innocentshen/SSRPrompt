import { Router } from 'express';
import { promptGroupsController } from '../controllers/prompt-groups.controller.js';
const router = Router();
/**
 * @swagger
 * /prompt-groups:
 *   get:
 *     tags: [PromptGroups]
 *     summary: 获取 Prompt 分组列表
 *   post:
 *     tags: [PromptGroups]
 *     summary: 创建 Prompt 分组
 */
router.get('/', (req, res, next) => promptGroupsController.list(req, res, next));
router.post('/', (req, res, next) => promptGroupsController.create(req, res, next));
/**
 * @swagger
 * /prompt-groups/{id}:
 *   put:
 *     tags: [PromptGroups]
 *     summary: 更新 Prompt 分组
 *   delete:
 *     tags: [PromptGroups]
 *     summary: 删除 Prompt 分组
 */
router.put('/:id', (req, res, next) => promptGroupsController.update(req, res, next));
router.delete('/:id', (req, res, next) => promptGroupsController.delete(req, res, next));
export default router;
//# sourceMappingURL=prompt-groups.routes.js.map