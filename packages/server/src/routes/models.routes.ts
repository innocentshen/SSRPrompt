import { Router } from 'express';
import { modelsController } from '../controllers/index.js';

const router = Router();

// Model CRUD (top-level)
router.get('/', (req, res, next) => modelsController.listAll(req, res, next));
router.get('/:id', (req, res, next) => modelsController.getById(req, res, next));
router.put('/:id', (req, res, next) => modelsController.update(req, res, next));
router.delete('/:id', (req, res, next) => modelsController.delete(req, res, next));

export default router;
