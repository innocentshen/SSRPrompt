// Environment validation must be first import
import './config/env.js';

import express from 'express';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { corsMiddleware, errorHandler, notFoundHandler } from './middleware/index.js';
import routes from './routes/index.js';

async function main() {
  // Connect to database
  await connectDatabase();

  // Create Express app
  const app = express();

  // Middleware
  app.use(corsMiddleware);
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use('/api/v1', routes);

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Start server
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT}`);
    console.log(`📚 API available at http://localhost:${env.PORT}/api/v1`);
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
