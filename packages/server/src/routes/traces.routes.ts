import { Router } from 'express';
import { tracesController } from '../controllers/traces.controller.js';

const router = Router();

// Traces CRUD
router.get('/', (req, res, next) => tracesController.list(req, res, next));
router.post('/', (req, res, next) => tracesController.create(req, res, next));
router.get('/:id', (req, res, next) => tracesController.getById(req, res, next));
router.delete('/:id', (req, res, next) => tracesController.delete(req, res, next));
router.delete('/by-prompt/:promptId', (req, res, next) => tracesController.deleteByPrompt(req, res, next));

export default router;
