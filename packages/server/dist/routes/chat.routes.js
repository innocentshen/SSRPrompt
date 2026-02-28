import { Router } from 'express';
import { chatController } from '../controllers/chat.controller.js';
import { asyncHandler } from '../middleware/error-handler.js';
const router = Router();
/**
 * @swagger
 * /chat/completions:
 *   post:
 *     tags: [Chat]
 *     summary: 对话补全
 *     description: 支持流式和非流式响应
 *     responses:
 *       200:
 *         description: 成功
 */
router.post('/completions', asyncHandler(chatController.completions));
export default router;
//# sourceMappingURL=chat.routes.js.map