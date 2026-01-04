import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';

import authRoutes from './auth.routes.js';
import healthRoutes from './health.routes.js';
import providersRoutes from './providers.routes.js';
import modelsRoutes from './models.routes.js';
import promptsRoutes from './prompts.routes.js';
import tracesRoutes from './traces.routes.js';
import statsRoutes from './stats.routes.js';
import evaluationsRoutes from './evaluations.routes.js';
import testCasesRoutes from './test-cases.routes.js';
import criteriaRoutes from './criteria.routes.js';
import runsRoutes from './runs.routes.js';
import chatRoutes from './chat.routes.js';

const router = Router();

// Public routes
router.use('/auth', authRoutes);
router.use('/health', healthRoutes);

// Protected routes (require authentication)
router.use('/providers', authenticateJWT, providersRoutes);
router.use('/models', authenticateJWT, modelsRoutes);
router.use('/prompts', authenticateJWT, promptsRoutes);
router.use('/traces', authenticateJWT, tracesRoutes);
router.use('/stats', statsRoutes);

// Evaluations and related routes
router.use('/evaluations', authenticateJWT, evaluationsRoutes);
router.use('/test-cases', authenticateJWT, testCasesRoutes);
router.use('/criteria', authenticateJWT, criteriaRoutes);
router.use('/runs', authenticateJWT, runsRoutes);

// Chat routes
router.use('/chat', authenticateJWT, chatRoutes);

export default router;
