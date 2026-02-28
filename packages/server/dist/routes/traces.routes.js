import { Router } from 'express';
import { tracesController } from '../controllers/traces.controller.js';
const router = Router();
/**
 * @swagger
 * /traces:
 *   get:
 *     tags: [Traces]
 *     summary: 获取调用追踪列表
 *     responses:
 *       200:
 *         description: 成功
 *   post:
 *     tags: [Traces]
 *     summary: 创建调用追踪
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.get('/', (req, res, next) => tracesController.list(req, res, next));
router.post('/', (req, res, next) => tracesController.create(req, res, next));
/**
 * @swagger
 * /traces/{id}:
 *   get:
 *     tags: [Traces]
 *     summary: 获取追踪详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *   delete:
 *     tags: [Traces]
 *     summary: 删除追踪
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: 删除成功
 */
router.get('/:id', (req, res, next) => tracesController.getById(req, res, next));
router.delete('/:id', (req, res, next) => tracesController.delete(req, res, next));
/**
 * @swagger
 * /traces/by-prompt/{promptId}:
 *   delete:
 *     tags: [Traces]
 *     summary: 按 Prompt 删除追踪
 *     parameters:
 *       - in: path
 *         name: promptId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: 删除成功
 */
router.delete('/by-prompt/:promptId', (req, res, next) => tracesController.deleteByPrompt(req, res, next));
export default router;
//# sourceMappingURL=traces.routes.js.map