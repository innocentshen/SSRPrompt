import express, { Router, Request, Response } from 'express';
import type { QueryRequest } from '../types/index.js';
import {
  getPool,
  handleSelect,
  handleInsert,
  handleUpdate,
  handleDelete,
  initializeSchema,
  testConnection,
  getSchemaVersion,
  executeSql,
} from '../services/mysql-service.js';

const router = Router();

router.post('/mysql-proxy', async (req: Request, res: Response) => {
  try {
    const body: QueryRequest = req.body;
    const { config, operation, table, columns, data, filters, orderBy, limit } = body;

    if (!config || !config.host || !config.database || !config.user) {
      return res.status(400).json({ error: 'Invalid database configuration' });
    }

    const pool = getPool(config);

    // Test connection
    if (operation === 'test') {
      await testConnection(pool);
      return res.json({ success: true });
    }

    // Initialize schema
    if (operation === 'initialize') {
      await initializeSchema(pool);
      return res.json({ success: true });
    }

    // Get schema version
    if (operation === 'get_schema_version') {
      const version = await getSchemaVersion(pool);
      return res.json({ success: true, version });
    }

    // Execute raw SQL (for migrations)
    if (operation === 'execute_sql') {
      const { sql } = body as QueryRequest & { sql: string };
      if (!sql) {
        return res.status(400).json({ error: 'SQL is required for execute_sql operation' });
      }
      await executeSql(pool, sql);
      return res.json({ success: true });
    }

    // All other operations require table name
    if (!table) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    let result: unknown = null;

    switch (operation) {
      case 'select':
        result = await handleSelect(pool, table, columns || '*', filters || [], orderBy || [], limit ?? null);
        break;
      case 'insert':
        if (!data) {
          throw new Error('Data is required for insert operation');
        }
        result = await handleInsert(pool, table, data);
        break;
      case 'update':
        if (!data) {
          throw new Error('Data is required for update operation');
        }
        result = await handleUpdate(pool, table, data as Record<string, unknown>, filters || []);
        break;
      case 'delete':
        await handleDelete(pool, table, filters || []);
        result = [];
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    res.json({ data: result });
  } catch (error) {
    console.error('MySQL Proxy Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
