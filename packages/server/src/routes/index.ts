import { Router, type IRouter } from 'express';
import { authenticateJWT } from '../middleware/auth.js';

import authRoutes from './auth.routes.js';
import healthRoutes from './health.routes.js';
import providersRoutes from './providers.routes.js';
import modelsRoutes from './models.routes.js';
import promptsRoutes from './prompts.routes.js';
import promptGroupsRoutes from './prompt-groups.routes.js';
import tracesRoutes from './traces.routes.js';
import statsRoutes from './stats.routes.js';
import evaluationsRoutes from './evaluations.routes.js';
import testCasesRoutes from './test-cases.routes.js';
import criteriaRoutes from './criteria.routes.js';
import runsRoutes from './runs.routes.js';
import chatRoutes from './chat.routes.js';
import usersRoutes from './users.routes.js';
import filesRoutes from './files.routes.js';
import ocrRoutes from './ocr.routes.js';
import evaluationImportsRoutes from './evaluation-imports.routes.js';
import shareLinksRoutes from './share-links.routes.js';
import shareRoutes from './share.routes.js';
import promptApiKeysRoutes from './prompt-api-keys.routes.js';
import openRoutes from './open.routes.js';

const router: IRouter = Router();

// Public routes
router.use('/auth', authRoutes);
router.use('/health', healthRoutes);
router.use('/open', openRoutes);

// Protected routes (require authentication)
router.use('/providers', authenticateJWT, providersRoutes);
router.use('/models', authenticateJWT, modelsRoutes);
router.use('/prompts', authenticateJWT, promptsRoutes);
router.use('/prompt-groups', authenticateJWT, promptGroupsRoutes);
router.use('/traces', authenticateJWT, tracesRoutes);
router.use('/stats', statsRoutes);

// Evaluations and related routes
router.use('/evaluations', authenticateJWT, evaluationsRoutes);
router.use('/test-cases', authenticateJWT, testCasesRoutes);
router.use('/criteria', authenticateJWT, criteriaRoutes);
router.use('/runs', authenticateJWT, runsRoutes);

// Chat routes
router.use('/chat', authenticateJWT, chatRoutes);

// File routes
router.use('/files', authenticateJWT, filesRoutes);

// OCR routes
router.use('/ocr', authenticateJWT, ocrRoutes);

// Evaluation imports
router.use('/evaluation-imports', authenticateJWT, evaluationImportsRoutes);

// Private share links
router.use('/share-links', authenticateJWT, shareLinksRoutes);
router.use('/share', authenticateJWT, shareRoutes);
router.use('/prompt-api-keys', authenticateJWT, promptApiKeysRoutes);

// Admin routes
router.use('/users', authenticateJWT, usersRoutes);

export default router;
