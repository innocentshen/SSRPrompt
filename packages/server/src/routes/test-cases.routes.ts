import { Router } from 'express';
import { testCasesController } from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router = Router();

// Test case routes (direct access by ID)
router.put('/:id', asyncHandler(testCasesController.update));
router.delete('/:id', asyncHandler(testCasesController.delete));

export default router;
