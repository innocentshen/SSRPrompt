import { Router } from 'express';
import multer from 'multer';
import { filesController } from '../controllers/files.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';
const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB
        files: 1,
    },
});
/**
 * @swagger
 * /files:
 *   post:
 *     tags: [Files]
 *     summary: Upload file
 *   get:
 *     tags: [Files]
 *     summary: Download file
 */
router.post('/', upload.single('file'), asyncHandler(filesController.upload));
router.get('/:id/meta', asyncHandler(filesController.getMeta));
router.get('/:id', asyncHandler(filesController.download));
export default router;
//# sourceMappingURL=files.routes.js.map