import { Router, type IRouter } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { shareController } from '../controllers/share.controller.js';

const router: IRouter = Router();

router.post('/:token/verify-password', asyncHandler(shareController.verifyPassword));
router.get('/p/:token', asyncHandler(shareController.getPrompt));
router.get('/e/:token', asyncHandler(shareController.getEvaluation));
router.post('/p/:token/copy', asyncHandler(shareController.copyPrompt));
router.post('/e/:token/copy', asyncHandler(shareController.copyEvaluation));
router.get('/e/:token/files/:fileId', asyncHandler(shareController.downloadEvaluationAttachment));

export default router;

