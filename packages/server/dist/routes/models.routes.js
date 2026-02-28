import { Router } from 'express';
import { modelsController } from '../controllers/index.js';
const router = Router();
/**
 * @swagger
 * /models:
 *   get:
 *     tags: [Models]
 *     summary: 获取所有模型
 *     responses:
 *       200:
 *         description: 成功
 */
router.get('/', (req, res, next) => modelsController.listAll(req, res, next));
/**
 * @swagger
 * /models/{id}:
 *   get:
 *     tags: [Models]
 *     summary: 获取模型详情
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
 *     tags: [Models]
 *     summary: 更新模型
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
 *     tags: [Models]
 *     summary: 删除模型
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
router.get('/:id', (req, res, next) => modelsController.getById(req, res, next));
router.put('/:id', (req, res, next) => modelsController.update(req, res, next));
router.delete('/:id', (req, res, next) => modelsController.delete(req, res, next));
export default router;
//# sourceMappingURL=models.routes.js.map