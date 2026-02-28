import { Router } from 'express';
import { tracesController } from '../controllers/traces.controller.js';
import { authenticateJWT } from '../middleware/auth.js';
const router = Router();
/**
 * @swagger
 * /stats/usage:
 *   get:
 *     tags: [Stats]
 *     summary: 获取使用统计
 *     responses:
 *       200:
 *         description: 成功
 */
router.get('/usage', authenticateJWT, (req, res, next) => tracesController.getUsageStats(req, res, next));
export default router;
//# sourceMappingURL=stats.routes.js.map