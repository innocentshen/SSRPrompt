import { Router } from 'express';
import { criteriaController } from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';
const router = Router();
/**
 * @swagger
 * /criteria/{id}:
 *   put:
 *     tags: [Criteria]
 *     summary: 更新评测标准
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
 *     tags: [Criteria]
 *     summary: 删除评测标准
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
router.put('/:id', asyncHandler(criteriaController.update));
router.delete('/:id', asyncHandler(criteriaController.delete));
export default router;
//# sourceMappingURL=criteria.routes.js.map