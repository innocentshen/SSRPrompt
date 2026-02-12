import { Router, type IRouter } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticatePromptApiKey } from '../middleware/prompt-api-key-auth.js';
import { openPromptsController } from '../controllers/open-prompts.controller.js';

const router: IRouter = Router();

router.post('/prompts/:promptId/invoke', authenticatePromptApiKey, asyncHandler(openPromptsController.invoke));

export default router;
