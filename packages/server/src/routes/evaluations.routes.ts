import { Router } from 'express';
import {
  evaluationsController,
  testCasesController,
  criteriaController,
  runsController,
} from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router = Router();

// Evaluations routes
router.get('/', asyncHandler(evaluationsController.list));
router.post('/', asyncHandler(evaluationsController.create));
router.get('/:id', asyncHandler(evaluationsController.getById));
router.put('/:id', asyncHandler(evaluationsController.update));
router.delete('/:id', asyncHandler(evaluationsController.delete));
router.post('/:id/copy', asyncHandler(evaluationsController.copy));

// Test cases routes (nested under evaluations)
router.post('/:evaluationId/test-cases', asyncHandler(testCasesController.create));

// Criteria routes (nested under evaluations)
router.post('/:evaluationId/criteria', asyncHandler(criteriaController.create));

// Runs routes (nested under evaluations)
router.post('/:evaluationId/runs', asyncHandler(runsController.create));

export default router;
