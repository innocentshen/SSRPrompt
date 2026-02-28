import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireRole } from '../middleware/auth.js';
import { ocrController } from '../controllers/ocr.controller.js';
const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB
        files: 1,
    },
});
router.get('/settings', asyncHandler(ocrController.getSettings));
router.put('/settings', asyncHandler(ocrController.updateSettings));
router.get('/system-settings', requireRole('admin'), asyncHandler(ocrController.getSystemSettings));
router.put('/system-settings', requireRole('admin'), asyncHandler(ocrController.updateSystemSettings));
router.post('/test', upload.single('file'), asyncHandler(ocrController.test));
router.post('/results', asyncHandler(ocrController.getResults));
export default router;
//# sourceMappingURL=ocr.routes.js.map