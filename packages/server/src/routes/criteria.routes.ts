import { Router } from 'express';
import { criteriaController } from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router = Router();

// Criteria routes (direct access by ID)
router.put('/:id', asyncHandler(criteriaController.update));
router.delete('/:id', asyncHandler(criteriaController.delete));

export default router;
