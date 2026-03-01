import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { promptApiKeysController } from '../controllers/prompt-api-keys.controller.js';
const router = Router();
router.get('/', asyncHandler(promptApiKeysController.list));
router.post('/', asyncHandler(promptApiKeysController.create));
router.post('/:id/revoke', asyncHandler(promptApiKeysController.revoke));
export default router;
//# sourceMappingURL=prompt-api-keys.routes.js.map