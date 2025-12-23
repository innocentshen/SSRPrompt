import mysql from 'mysql2/promise';
import crypto from 'crypto';
import type { MySQLConfig, FilterCondition } from '../types/index.js';
import { buildWhereClause, buildOrderByClause, processRow } from '../utils/query-builder.js';
import { SCHEMA_SQL } from '../utils/schema.js';

const pools = new Map<string, mysql.Pool>();

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
      queueLimit: 0,
    });
    pools.set(key, pool);
  }

  return pools.get(key)!;
}

export async function handleSelect(
  pool: mysql.Pool,
  table: string,
  columns: string,
  filters: FilterCondition[],
  orderBy: { column: string; ascending: boolean }[],
  limit: number | null
): Promise<Record<string, unknown>[]> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const { sql: whereClause, values } = buildWhereClause(filters);
  const orderClause = buildOrderByClause(orderBy);
  const limitClause = limit ? ` LIMIT ${limit}` : '';

  const query = `SELECT ${columns} FROM ${safeTable}${whereClause}${orderClause}${limitClause}`;
  console.log('[MySQL Select] Query:', query);

  try {
    const [rows] = await pool.query(query, values);
    console.log('[MySQL Select] Raw rows count:', (rows as unknown[]).length);

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
