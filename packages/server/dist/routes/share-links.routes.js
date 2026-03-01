import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { shareLinksController } from '../controllers/share-links.controller.js';
const router = Router();
router.get('/', asyncHandler(shareLinksController.list));
router.post('/', asyncHandler(shareLinksController.create));
router.put('/:id', asyncHandler(shareLinksController.update));
router.post('/:id/revoke', asyncHandler(shareLinksController.revoke));
router.get('/:id/logs', asyncHandler(shareLinksController.listAccessLogs));
export default router;
//# sourceMappingURL=share-links.routes.js.map