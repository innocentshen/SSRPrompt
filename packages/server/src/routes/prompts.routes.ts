import { Router } from 'express';
import { promptsController } from '../controllers/prompts.controller.js';

const router = Router();

// Prompt CRUD
router.get('/', (req, res, next) => promptsController.list(req, res, next));
router.post('/', (req, res, next) => promptsController.create(req, res, next));
router.put('/batch-order', (req, res, next) => promptsController.batchUpdateOrder(req, res, next));
router.get('/:id', (req, res, next) => promptsController.getById(req, res, next));
router.put('/:id', (req, res, next) => promptsController.update(req, res, next));
router.delete('/:id', (req, res, next) => promptsController.delete(req, res, next));
router.put('/:id/order', (req, res, next) => promptsController.updateOrder(req, res, next));

// Versions
router.get('/:id/versions', (req, res, next) => promptsController.getVersions(req, res, next));
router.post('/:id/versions', (req, res, next) => promptsController.createVersion(req, res, next));
router.get('/:id/versions/:version', (req, res, next) => promptsController.getVersion(req, res, next));

export default router;
