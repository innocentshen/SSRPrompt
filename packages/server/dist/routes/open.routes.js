import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticatePromptApiKey } from '../middleware/prompt-api-key-auth.js';
import { openPromptsController } from '../controllers/open-prompts.controller.js';
const router = Router();
router.post('/prompts/:promptId/invoke', authenticatePromptApiKey, asyncHandler(openPromptsController.invoke));
export default router;
//# sourceMappingURL=open.routes.js.map