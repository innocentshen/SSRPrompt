import { Router } from 'express';
import { providersController } from '../controllers/index.js';
import { modelsController } from '../controllers/index.js';

const router = Router();

// Provider CRUD
router.get('/', (req, res, next) => providersController.list(req, res, next));
router.post('/', (req, res, next) => providersController.create(req, res, next));
router.get('/:id', (req, res, next) => providersController.getById(req, res, next));
router.put('/:id', (req, res, next) => providersController.update(req, res, next));
router.delete('/:id', (req, res, next) => providersController.delete(req, res, next));

// Models under provider
router.get('/:providerId/models', (req, res, next) => modelsController.listByProvider(req, res, next));
router.post('/:providerId/models', (req, res, next) => modelsController.create(req, res, next));

export default router;
