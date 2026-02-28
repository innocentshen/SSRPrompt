import { Router } from 'express';
import { testCasesController } from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';
const router = Router();
/**
 * @swagger
 * /test-cases/{id}:
 *   put:
 *     tags: [TestCases]
 *     summary: 更新测试用例
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
 *     tags: [TestCases]
 *     summary: 删除测试用例
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
router.put('/:id', asyncHandler(testCasesController.update));
router.delete('/:id', asyncHandler(testCasesController.delete));
export default router;
//# sourceMappingURL=test-cases.routes.js.map