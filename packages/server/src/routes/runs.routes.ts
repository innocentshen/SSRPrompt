import { Router } from 'express';
import { runsController } from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router = Router();

// Runs routes (direct access by ID)
router.delete('/:id', asyncHandler(runsController.delete));
router.get('/:id/results', asyncHandler(runsController.getResults));
router.post('/:id/results', asyncHandler(runsController.addResult));

export default router;
