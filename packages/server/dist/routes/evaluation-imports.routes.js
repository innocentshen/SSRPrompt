import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/error-handler.js';
import { evaluationImportsController } from '../controllers/evaluation-imports.controller.js';
const router = Router();
const maxZipBytes = Math.max(1, Number(process.env.EVALUATION_IMPORT_MAX_ZIP_BYTES || String(200 * 1024 * 1024)));
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: maxZipBytes,
        files: 1,
    },
});
router.post('/zip', upload.single('file'), asyncHandler(evaluationImportsController.createZip));
router.get('/template', asyncHandler(evaluationImportsController.downloadTemplate));
router.get('/export/:evaluationId', asyncHandler(evaluationImportsController.exportEvaluation));
router.get('/:id', asyncHandler(evaluationImportsController.getJob));
export default router;
//# sourceMappingURL=evaluation-imports.routes.js.map