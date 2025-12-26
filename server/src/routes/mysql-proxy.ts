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
  handleBatchSelect,
  handleEvaluationDetails,
} from '../services/mysql-service.js';

const router = Router();

router.post('/mysql-proxy', async (req: Request, res: Response) => {
  try {
    const body: QueryRequest = req.body;
    const { config, operation, table, columns, data, filters, orderBy, limit, offset } = body;

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
      const { sql } = body;
      if (!sql) {
        return res.status(400).json({ error: 'SQL is required for execute_sql operation' });
      }
      await executeSql(pool, sql);
      return res.json({ success: true });
    }

    // Batch query - execute multiple SELECT queries in one request
    if (operation === 'batch') {
      const { batch } = body;
      if (!batch || !batch.queries || !Array.isArray(batch.queries)) {
        return res.status(400).json({ error: 'batch.queries array is required for batch operation' });
      }
      const result = await handleBatchSelect(pool, batch);
      return res.json({ data: result });
    }

    // Evaluation details - get all data for an evaluation in one request
    if (operation === 'evaluation_details') {
      const { evaluationId } = body;
      if (!evaluationId) {
        return res.status(400).json({ error: 'evaluationId is required for evaluation_details operation' });
      }
      const result = await handleEvaluationDetails(pool, evaluationId);
      return res.json({ data: result });
    }

    // All other operations require table name
    if (!table) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    let result: unknown = null;

    switch (operation) {
      case 'select':
        result = await handleSelect(pool, table, columns || '*', filters || [], orderBy || [], limit ?? null, offset ?? null);
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
