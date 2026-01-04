import { Router } from 'express';
import { chatController } from '../controllers/chat.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router = Router();

// Chat completion endpoint (supports both streaming and non-streaming)
router.post('/completions', asyncHandler(chatController.completions));

export default router;
