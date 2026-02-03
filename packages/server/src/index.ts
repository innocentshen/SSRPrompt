// Environment validation must be first import
import './config/env.js';

import express from 'express';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { checkS3Connection } from './config/s3.js';
import { corsMiddleware, errorHandler, notFoundHandler } from './middleware/index.js';
import routes from './routes/index.js';
import { swaggerSpec } from './config/swagger.js';

async function main() {
  // Connect to database
  await connectDatabase();

  // Validate S3/MinIO connectivity (non-fatal)
  await checkS3Connection();

  // Create Express app
  const app = express();

  // Security / reverse proxy settings
  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Middleware
  app.use((req, res, next) => {
    const header = req.headers['x-request-id'];
    const requestId =
      typeof header === 'string' && header.trim().length > 0 ? header.trim() : randomUUID();

    res.setHeader('X-Request-Id', requestId);
    // Useful for correlating logs in downstream handlers.
    req.requestId = requestId;
    next();
  });

  app.use(corsMiddleware);

  // Prevent sensitive API responses from being cached across sessions/users.
  app.use('/api/v1', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const vary = res.getHeader('Vary');
    const existing = Array.isArray(vary)
      ? vary.flatMap((v) => String(v).split(','))
      : typeof vary === 'string'
        ? vary.split(',')
        : [];
    const values = new Set(existing.map((v) => v.trim()).filter(Boolean));
    values.add('Authorization');
    res.setHeader('Vary', Array.from(values).join(', '));
    next();
  });

  // Global API rate limiting
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later.',
            requestId: req.requestId,
          },
        });
      },
    })
  );

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use('/api/v1', routes);

  // Swagger docs
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Start server
  const server = app.listen(env.PORT, () => {
    console.log(`Server running on http://localhost:${env.PORT}`);
    console.log(`API available at http://localhost:${env.PORT}/api/v1`);
    console.log(`Swagger docs at http://localhost:${env.PORT}/api-docs`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Error: Port ${env.PORT} is already in use.`);
      console.error('   Stop the other process, or start the server with a different PORT.');
      console.error('   Example (PowerShell): $env:PORT=3002; pnpm run dev:server');
      process.exit(1);
    }

    console.error('Server error:', error);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
