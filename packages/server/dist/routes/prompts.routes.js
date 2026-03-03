import { Router } from 'express';
import { promptsController } from '../controllers/prompts.controller.js';
import { evaluationsController } from '../controllers/evaluations.controller.js';
const router = Router();
/**
 * @swagger
 * /prompts:
 *   get:
 *     tags: [Prompts]
 *     summary: 获取 Prompt 列表
 *     responses:
 *       200:
 *         description: 成功
 *   post:
 *     tags: [Prompts]
 *     summary: 创建 Prompt
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.get('/', (req, res, next) => promptsController.list(req, res, next));
router.post('/', (req, res, next) => promptsController.create(req, res, next));
/**
 * Public Prompt Plaza routes
 */
router.get('/public', (req, res, next) => promptsController.listPublic(req, res, next));
router.get('/public/:id', (req, res, next) => promptsController.getPublicById(req, res, next));
router.get('/public/:id/versions', (req, res, next) => promptsController.getPublicVersions(req, res, next));
router.get('/public/:id/versions/:version', (req, res, next) => promptsController.getPublicVersion(req, res, next));
router.post('/public/:id/copy', (req, res, next) => promptsController.copyPublic(req, res, next));
/**
 * @swagger
 * /prompts/batch-order:
 *   put:
 *     tags: [Prompts]
 *     summary: 批量更新排序
 *     responses:
 *       200:
 *         description: 成功
 */
router.put('/batch-order', (req, res, next) => promptsController.batchUpdateOrder(req, res, next));
/**
 * @swagger
 * /prompts/{id}:
 *   get:
 *     tags: [Prompts]
 *     summary: 获取 Prompt 详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *   put:
 *     tags: [Prompts]
 *     summary: 更新 Prompt
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
 *     tags: [Prompts]
 *     summary: 删除 Prompt
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
router.get('/:id', (req, res, next) => promptsController.getById(req, res, next));
router.put('/:id', (req, res, next) => promptsController.update(req, res, next));
router.delete('/:id', (req, res, next) => promptsController.delete(req, res, next));
/**
 * @swagger
 * /prompts/{id}/evaluations:
 *   get:
 *     tags: [Prompts]
 *     summary: Get evaluations linked to a prompt
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Evaluation list
 */
router.get('/:id/evaluations', (req, res) => evaluationsController.getByPromptId(req, res));
/**
 * @swagger
 * /prompts/{id}/evaluations/{evaluationId}/summary:
 *   get:
 *     tags: [Prompts]
 *     summary: Get aggregated evaluation summary
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: evaluationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Evaluation summary
 */
router.get('/:id/evaluations/:evaluationId/summary', (req, res) => evaluationsController.getSummary(req, res));
/**
 * @swagger
 * /prompts/{id}/order:
 *   put:
 *     tags: [Prompts]
 *     summary: 更新单个 Prompt 排序
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 */
router.put('/:id/order', (req, res, next) => promptsController.updateOrder(req, res, next));
/**
 * @swagger
 * /prompts/{id}/versions:
 *   get:
 *     tags: [Prompts]
 *     summary: 获取版本列表
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *   post:
 *     tags: [Prompts]
 *     summary: 创建新版本
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.get('/:id/versions', (req, res, next) => promptsController.getVersions(req, res, next));
router.post('/:id/versions', (req, res, next) => promptsController.createVersion(req, res, next));
/**
 * @swagger
 * /prompts/{id}/versions/{version}:
 *   get:
 *     tags: [Prompts]
 *     summary: 获取指定版本
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: version
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 成功
 */
router.get('/:id/versions/:version', (req, res, next) => promptsController.getVersion(req, res, next));
export default router;
//# sourceMappingURL=prompts.routes.js.map