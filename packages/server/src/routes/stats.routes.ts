import { Router } from 'express';
import { tracesController } from '../controllers/traces.controller.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

// Usage statistics
router.get('/usage', authenticateJWT, (req, res, next) => tracesController.getUsageStats(req, res, next));

export default router;
