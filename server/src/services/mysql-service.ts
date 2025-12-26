import mysql from 'mysql2/promise';
import crypto from 'crypto';
import type { MySQLConfig, FilterCondition, BatchQueryRequest } from '../types/index.js';
import { buildWhereClause, buildOrderByClause, processRow } from '../utils/query-builder.js';
import { SCHEMA_SQL } from '../utils/schema.js';

const pools = new Map<string, mysql.Pool>();
const poolWarmupStatus = new Map<string, boolean>();

// 是否启用详细日志（生产环境可以关闭）
const VERBOSE_LOG = process.env.VERBOSE_LOG === 'true';

function getPoolKey(config: MySQLConfig): string {
  return `${config.host}:${config.port}:${config.database}:${config.user}`;
}

// 将 ISO 8601 日期格式转换为 MySQL 格式
function convertDateForMySQL(value: unknown): unknown {
  if (typeof value === 'string') {
    // 检测是否是 ISO 8601 格式的日期 (如 2025-12-21T03:14:34.606Z)
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    if (isoDateRegex.test(value)) {
      const date = new Date(value);
      // 转换为 MySQL 格式: YYYY-MM-DD HH:MM:SS
      return date.toISOString().slice(0, 19).replace('T', ' ');
    }
  }
  return value;
}

// 处理数据值，转换日期和 JSON
function processValueForMySQL(val: unknown): unknown {
  // 先转换日期
  val = convertDateForMySQL(val);
  // 再处理对象
  if (typeof val === 'object' && val !== null) {
    return JSON.stringify(val);
  }
  return val;
}

// 预热连接池 - 提前建立连接
async function warmupPool(pool: mysql.Pool, key: string): Promise<void> {
  if (poolWarmupStatus.get(key)) {
    return;
  }

  try {
    // 获取一个连接来预热连接池
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    poolWarmupStatus.set(key, true);
    if (VERBOSE_LOG) {
      console.log(`[MySQL] Pool warmed up: ${key}`);
    }
  } catch (err) {
    console.error(`[MySQL] Pool warmup failed: ${key}`, err);
  }
}

export function getPool(config: MySQLConfig): mysql.Pool {
  const key = getPoolKey(config);

  if (!pools.has(key)) {
    const pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 5,                    // 最大空闲连接数
      idleTimeout: 60000,            // 空闲连接超时时间 60秒
      queueLimit: 0,
      enableKeepAlive: true,         // 启用 TCP keep-alive
      keepAliveInitialDelay: 10000,  // keep-alive 初始延迟 10秒
      connectTimeout: 10000,         // 连接超时 10秒
    });
    pools.set(key, pool);

    // 异步预热连接池（不阻塞当前请求）
    warmupPool(pool, key);
  }

  return pools.get(key)!;
}

export async function handleSelect(
  pool: mysql.Pool,
  table: string,
  columns: string,
  filters: FilterCondition[],
  orderBy: { column: string; ascending: boolean }[],
  limit: number | null,
  offset: number | null = null
): Promise<Record<string, unknown>[]> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const { sql: whereClause, values } = buildWhereClause(filters);
  const orderClause = buildOrderByClause(orderBy);
  let limitClause = '';
  if (limit) {
    limitClause = offset ? ` LIMIT ${offset}, ${limit}` : ` LIMIT ${limit}`;
  }

  const query = `SELECT ${columns} FROM ${safeTable}${whereClause}${orderClause}${limitClause}`;
  if (VERBOSE_LOG) {
    console.log('[MySQL Select] Query:', query);
  }

  try {
    const [rows] = await pool.query(query, values);
    if (VERBOSE_LOG) {
      console.log('[MySQL Select] Raw rows count:', (rows as unknown[]).length);
    }

    const processedRows = (rows as Record<string, unknown>[]).map((row, index) => {
      try {
        return processRow(row);
      } catch (err) {
        console.error(`[MySQL Select] Error processing row ${index}:`, err, 'Row data:', row);
        throw err;
      }
    });

    return processedRows;
  } catch (err) {
    console.error('[MySQL Select] Query error:', err);
    throw err;
  }
}

export async function handleInsert(
  pool: mysql.Pool,
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const rows = Array.isArray(data) ? data : [data];
  const results: Record<string, unknown>[] = [];

  for (const row of rows) {
    const id = row.id || crypto.randomUUID();
    const rowWithId: Record<string, unknown> = { ...row, id };

    const columns = Object.keys(rowWithId).filter(k => rowWithId[k] !== undefined);
    const values = columns.map(k => processValueForMySQL(rowWithId[k]));
    const placeholders = columns.map(() => '?').join(', ');
    const safeCols = columns.map(c => c.replace(/[^a-zA-Z0-9_]/g, '')).join(', ');

    const query = `INSERT INTO ${safeTable} (${safeCols}) VALUES (${placeholders})`;
    await pool.query(query, values);

    const [selectResult] = await pool.query(`SELECT * FROM ${safeTable} WHERE id = ?`, [id]);
    if (selectResult && (selectResult as unknown[]).length > 0) {
      results.push(processRow((selectResult as Record<string, unknown>[])[0]));
    }
  }

  return results;
}

export async function handleUpdate(
  pool: mysql.Pool,
  table: string,
  data: Record<string, unknown>,
  filters: FilterCondition[]
): Promise<Record<string, unknown>[]> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const { sql: whereClause, values: whereValues } = buildWhereClause(filters);

  const setCols = Object.keys(data).filter(k => data[k] !== undefined);
  const setValues = setCols.map(k => processValueForMySQL(data[k]));
  const setClause = setCols.map(c => `${c.replace(/[^a-zA-Z0-9_]/g, '')} = ?`).join(', ');

  const query = `UPDATE ${safeTable} SET ${setClause}${whereClause}`;
  await pool.query(query, [...setValues, ...whereValues]);

  const selectQuery = `SELECT * FROM ${safeTable}${whereClause}`;
  const [result] = await pool.query(selectQuery, whereValues);
  return (result as Record<string, unknown>[]).map(processRow);
}

export async function handleDelete(
  pool: mysql.Pool,
  table: string,
  filters: FilterCondition[]
): Promise<void> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const { sql: whereClause, values } = buildWhereClause(filters);

  const query = `DELETE FROM ${safeTable}${whereClause}`;
  await pool.query(query, values);
}

export async function initializeSchema(pool: mysql.Pool): Promise<void> {
  const statements = SCHEMA_SQL.split(';').filter(s => s.trim());
  for (const statement of statements) {
    if (statement.trim()) {
      await pool.query(statement.trim() + ';');
    }
  }
}

export async function testConnection(pool: mysql.Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export async function getSchemaVersion(pool: mysql.Pool): Promise<number> {
  try {
    // 检查 schema_migrations 表是否存在
    const [tables] = await pool.query(
      "SHOW TABLES LIKE 'schema_migrations'"
    );

    if ((tables as unknown[]).length === 0) {
      return 0;
    }

    // 获取最高版本号
    const [rows] = await pool.query(
      'SELECT MAX(version) as version FROM schema_migrations'
    );

    const result = rows as { version: number | null }[];
    return result[0]?.version || 0;
  } catch (err) {
    console.error('[MySQL] Error getting schema version:', err);
    return 0;
  }
}

export async function executeSql(pool: mysql.Pool, sql: string): Promise<void> {
  // 将 SQL 按分号分割成多条语句执行
  const statements = sql.split(';').filter(s => s.trim());
  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await pool.query(statement.trim() + ';');
      } catch (err) {
        console.error('[MySQL] Error executing SQL statement:', statement.substring(0, 100), err);
        throw err;
      }
    }
  }
}

/**
 * 批量查询 - 一次执行多个 SELECT 查询，减少网络往返
 */
export async function handleBatchSelect(
  pool: mysql.Pool,
  batch: BatchQueryRequest
): Promise<Record<string, Record<string, unknown>[]>> {
  const results: Record<string, Record<string, unknown>[]> = {};

  // 并行执行所有查询
  const queryPromises = batch.queries.map(async (query) => {
    const data = await handleSelect(
      pool,
      query.table,
      query.columns || '*',
      query.filters || [],
      query.orderBy || [],
      query.limit ?? null,
      query.offset ?? null
    );
    return { key: query.key, data };
  });

  const queryResults = await Promise.all(queryPromises);

  for (const { key, data } of queryResults) {
    results[key] = data;
  }

  return results;
}

/**
 * 评测详情专用查询 - 一次请求获取评测的所有相关数据
 * 包括：test_cases, evaluation_criteria, evaluation_runs, 以及最新完成运行的 test_case_results
 */
export async function handleEvaluationDetails(
  pool: mysql.Pool,
  evaluationId: string
): Promise<{
  testCases: Record<string, unknown>[];
  criteria: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  results: Record<string, unknown>[];
  latestCompletedRunId: string | null;
}> {
  // 并行查询 test_cases, criteria, runs
  const [testCases, criteria, runs] = await Promise.all([
    handleSelect(
      pool,
      'test_cases',
      '*',  // 使用 SELECT * 保持兼容性
      [{ column: 'evaluation_id', operator: '=', value: evaluationId }],
      [{ column: 'order_index', ascending: true }],
      null,
      null
    ),
    handleSelect(
      pool,
      'evaluation_criteria',
      '*',
      [{ column: 'evaluation_id', operator: '=', value: evaluationId }],
      [{ column: 'created_at', ascending: true }],
      null,
      null
    ),
    handleSelect(
      pool,
      'evaluation_runs',
      '*',
      [{ column: 'evaluation_id', operator: '=', value: evaluationId }],
      [{ column: 'created_at', ascending: false }],
      null,
      null
    ),
  ]);

  // 找到最新完成的运行
  const latestCompletedRun = runs.find(r => r.status === 'completed');
  const latestCompletedRunId = latestCompletedRun ? String(latestCompletedRun.id) : null;

  // 如果有完成的运行，获取其结果
  let results: Record<string, unknown>[] = [];
  if (latestCompletedRunId) {
    results = await handleSelect(
      pool,
      'test_case_results',
      '*',
      [{ column: 'run_id', operator: '=', value: latestCompletedRunId }],
      [{ column: 'created_at', ascending: true }],
      null,
      null
    );
  }

  return {
    testCases,
    criteria,
    runs,
    results,
    latestCompletedRunId,
  };
}
