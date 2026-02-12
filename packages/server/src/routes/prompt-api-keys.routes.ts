import { Router, type IRouter } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { promptApiKeysController } from '../controllers/prompt-api-keys.controller.js';

const router: IRouter = Router();

router.get('/', asyncHandler(promptApiKeysController.list));
router.post('/', asyncHandler(promptApiKeysController.create));
router.post('/:id/revoke', asyncHandler(promptApiKeysController.revoke));

export default router;
