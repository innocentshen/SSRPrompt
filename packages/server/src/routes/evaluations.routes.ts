import { Router, type IRouter } from 'express';
import {
  evaluationsController,
  testCasesController,
  criteriaController,
  runsController,
} from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router: IRouter = Router();

/**
 * @swagger
 * /evaluations:
 *   get:
 *     tags: [Evaluations]
 *     summary: 获取评测列表
 *     responses:
 *       200:
 *         description: 成功
 *   post:
 *     tags: [Evaluations]
 *     summary: 创建评测
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.get('/', asyncHandler(evaluationsController.list));
router.post('/', asyncHandler(evaluationsController.create));

/**
 * @swagger
 * /evaluations/batch-order:
 *   put:
 *     tags: [Evaluations]
 *     summary: 批量更新评测排序
 *     responses:
 *       200:
 *         description: 成功
 */
router.put('/batch-order', asyncHandler(evaluationsController.batchUpdateOrder));

/**
 * @swagger
 * /evaluations/{id}:
 *   get:
 *     tags: [Evaluations]
 *     summary: 获取评测详情
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
 *     tags: [Evaluations]
 *     summary: 更新评测
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
 *     tags: [Evaluations]
 *     summary: 删除评测
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
router.get('/:id', asyncHandler(evaluationsController.getById));
router.put('/:id', asyncHandler(evaluationsController.update));
router.delete('/:id', asyncHandler(evaluationsController.delete));

/**
 * @swagger
 * /evaluations/{id}/copy:
 *   post:
 *     tags: [Evaluations]
 *     summary: 复制评测
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 复制成功
 */
router.post('/:id/copy', asyncHandler(evaluationsController.copy));

/**
 * @swagger
 * /evaluations/{evaluationId}/test-cases:
 *   post:
 *     tags: [TestCases]
 *     summary: 创建测试用例
 *     parameters:
 *       - in: path
 *         name: evaluationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.post('/:evaluationId/test-cases', asyncHandler(testCasesController.create));

/**
 * @swagger
 * /evaluations/{evaluationId}/criteria:
 *   post:
 *     tags: [Criteria]
 *     summary: 创建评测标准
 *     parameters:
 *       - in: path
 *         name: evaluationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.post('/:evaluationId/criteria', asyncHandler(criteriaController.create));

/**
 * @swagger
 * /evaluations/{evaluationId}/runs:
 *   post:
 *     tags: [Runs]
 *     summary: 创建评测运行
 *     parameters:
 *       - in: path
 *         name: evaluationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.post('/:evaluationId/runs', asyncHandler(runsController.create));

/**
 * @swagger
 * /evaluations/{evaluationId}/runs/execute:
 *   post:
 *     tags: [Runs]
 *     summary: 创建并执行评测运行
 *     parameters:
 *       - in: path
 *         name: evaluationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.post('/:evaluationId/runs/execute', asyncHandler(runsController.execute));

export default router;
