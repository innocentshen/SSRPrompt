import { Router, type IRouter } from 'express';
import { runsController } from '../controllers/evaluations.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router: IRouter = Router();

/**
 * @swagger
 * /runs/{id}:
 *   get:
 *     tags: [Runs]
 *     summary: Get run by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *   put:
 *     tags: [Runs]
 *     summary: Update run status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *   delete:
 *     tags: [Runs]
 *     summary: Delete run
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Success
 */
router.get('/:id', asyncHandler(runsController.getById));
router.put('/:id', asyncHandler(runsController.update));
router.delete('/:id', asyncHandler(runsController.delete));

/**
 * @swagger
 * /runs/{id}/abort:
 *   post:
 *     tags: [Runs]
 *     summary: Abort run
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/:id/abort', asyncHandler(runsController.abort));

/**
 * @swagger
 * /runs/{id}/retry-scores:
 *   post:
 *     tags: [Runs]
 *     summary: Retry AI scoring for a run in background worker
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/:id/retry-scores', asyncHandler(runsController.retryScores));

/**
 * @swagger
 * /runs/{id}/retry-errored-cases:
 *   post:
 *     tags: [Runs]
 *     summary: Retry errored test cases in the same run
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/:id/retry-errored-cases', asyncHandler(runsController.retryErroredCases));

/**
 * @swagger
 * /runs/{id}/results:
 *   get:
 *     tags: [Runs]
 *     summary: Get run results
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *   post:
 *     tags: [Runs]
 *     summary: Add run result
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Created
 */
router.get('/:id/results', asyncHandler(runsController.getResults));
router.post('/:id/results', asyncHandler(runsController.addResult));

/**
 * @swagger
 * /runs/{id}/results/batch:
 *   post:
 *     tags: [Runs]
 *     summary: Add run results in batch
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/:id/results/batch', asyncHandler(runsController.addResultsBatch));

export default router;
