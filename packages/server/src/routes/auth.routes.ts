import { Router } from 'express';
import { generateDemoToken } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/v1/auth/demo-token
 * Generate a demo token for unauthenticated users
 */
router.get('/demo-token', (_req, res) => {
  const { token, userId } = generateDemoToken();

  res.json({
    data: {
      token,
      user: {
        id: userId,
        tenantType: 'demo',
      },
    },
  });
});

export default router;
