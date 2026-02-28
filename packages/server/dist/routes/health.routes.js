import { Router } from 'express';
import { prisma } from '../config/database.js';
const router = Router();
/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: 健康检查
 *     security: []
 *     responses:
 *       200:
 *         description: 服务正常
 *       503:
 *         description: 服务异常
 */
router.get('/', async (_req, res) => {
    try {
        // Check database connection
        await prisma.$queryRaw `SELECT 1`;
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            database: 'connected',
        });
    }
    catch (error) {
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
export default router;
//# sourceMappingURL=health.routes.js.map