import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface MySQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

interface FilterCondition {
  column: string;
  operator: string;
  value: unknown;
}

interface QueryRequest {
  config: MySQLConfig;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'test' | 'initialize';
  table?: string;
  columns?: string;
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: FilterCondition[];
  orderBy?: { column: string; ascending: boolean }[];
  limit?: number | null;
  singleRow?: boolean;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS providers (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  name VARCHAR(255) NOT NULL,
  type ENUM('openai', 'anthropic', 'gemini', 'azure', 'custom') NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_providers_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS models (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  provider_id VARCHAR(36) NOT NULL,
  model_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  capabilities JSON,
  supports_vision BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_models_provider_id (provider_id),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prompts (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT,
  variables JSON,
  messages JSON,
  config JSON,
  current_version INT DEFAULT 1,
  default_model_id VARCHAR(36),
  order_index INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_prompts_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prompt_versions (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  prompt_id VARCHAR(36) NOT NULL,
  version INT NOT NULL,
  content TEXT NOT NULL,
  commit_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_prompt_versions_prompt_id (prompt_id),
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluations (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  name VARCHAR(255) NOT NULL,
  prompt_id VARCHAR(36),
  model_id VARCHAR(36),
  judge_model_id VARCHAR(36),
  status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending',
  config JSON,
  results JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX idx_evaluations_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending',
  results JSON,
  error_message TEXT,
  total_tokens_input INT DEFAULT 0,
  total_tokens_output INT DEFAULT 0,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_evaluation_runs_evaluation_id (evaluation_id),
  INDEX idx_evaluation_runs_status (status),
  INDEX idx_evaluation_runs_created_at (created_at DESC),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS test_cases (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) DEFAULT '',
  input_text TEXT NOT NULL,
  input_variables JSON,
  attachments JSON,
  expected_output TEXT,
  notes TEXT,
  order_index INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_test_cases_evaluation_id (evaluation_id),
  INDEX idx_test_cases_order (evaluation_id, order_index),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  prompt TEXT,
  weight DECIMAL(5,2) DEFAULT 1.0,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_evaluation_criteria_evaluation_id (evaluation_id),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS test_case_results (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  evaluation_id VARCHAR(36) NOT NULL,
  test_case_id VARCHAR(36) NOT NULL,
  run_id VARCHAR(36),
  model_output TEXT,
  scores JSON,
  ai_feedback JSON,
  latency_ms INT DEFAULT 0,
  tokens_input INT DEFAULT 0,
  tokens_output INT DEFAULT 0,
  passed BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_test_case_results_evaluation_id (evaluation_id),
  INDEX idx_test_case_results_test_case_id (test_case_id),
  INDEX idx_test_case_results_run_id (run_id),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES evaluation_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS traces (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL DEFAULT 'demo',
  prompt_id VARCHAR(36),
  model_id VARCHAR(36),
  input TEXT NOT NULL,
  output TEXT,
  tokens_input INT DEFAULT 0,
  tokens_output INT DEFAULT 0,
  latency_ms INT DEFAULT 0,
  status ENUM('success', 'error') DEFAULT 'success',
  error_message TEXT,
  metadata JSON,
  attachments JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_traces_user_id (user_id),
  INDEX idx_traces_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function getConnection(config: MySQLConfig): Promise<Client> {
  const client = await new Client().connect({
    hostname: config.host,
    port: config.port,
    db: config.database,
    username: config.user,
    password: config.password,
  });
  return client;
}

function buildWhereClause(filters: FilterCondition[]): { sql: string; values: unknown[] } {
  if (!filters || filters.length === 0) {
    return { sql: '', values: [] };
  }

  const conditions: string[] = [];
  const values: unknown[] = [];

  for (const filter of filters) {
    const col = filter.column.replace(/[^a-zA-Z0-9_]/g, '');
    if (filter.operator === 'IN') {
      const arr = filter.value as unknown[];
      const placeholders = arr.map(() => '?').join(', ');
      conditions.push(`${col} IN (${placeholders})`);
      values.push(...arr);
    } else {
      conditions.push(`${col} ${filter.operator} ?`);
      values.push(filter.value);
    }
  }

  return { sql: ' WHERE ' + conditions.join(' AND '), values };
}

function buildOrderByClause(orderBy: { column: string; ascending: boolean }[]): string {
  if (!orderBy || orderBy.length === 0) {
    return '';
  }

  const parts = orderBy.map(o => {
    const col = o.column.replace(/[^a-zA-Z0-9_]/g, '');
    return `${col} ${o.ascending ? 'ASC' : 'DESC'}`;
  });

  return ' ORDER BY ' + parts.join(', ');
}

function generateUUID(): string {
  return crypto.randomUUID();
}

function processRow(row: Record<string, unknown>): Record<string, unknown> {
  const processed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      processed[key] = value.toISOString();
    } else if (typeof value === 'string' && (key.includes('variables') || key.includes('config') || key.includes('results') || key.includes('metadata') || key.includes('scores') || key.includes('ai_feedback') || key.includes('attachments') || key === 'capabilities' || key === 'input_variables')) {
      try {
        processed[key] = JSON.parse(value);
      } catch {
        processed[key] = value;
      }
    } else {
      processed[key] = value;
    }
  }
  return processed;
}

async function handleSelect(
  client: Client,
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
  const result = await client.query(query, values);
  return (result as Record<string, unknown>[]).map(processRow);
}

async function handleInsert(
  client: Client,
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const rows = Array.isArray(data) ? data : [data];
  const results: Record<string, unknown>[] = [];

  for (const row of rows) {
    const id = row.id || generateUUID();
    const rowWithId = { ...row, id };
    
    const columns = Object.keys(rowWithId).filter(k => rowWithId[k] !== undefined);
    const values = columns.map(k => {
      const val = rowWithId[k];
      if (typeof val === 'object' && val !== null) {
        return JSON.stringify(val);
      }
      return val;
    });
    const placeholders = columns.map(() => '?').join(', ');
    const safeCols = columns.map(c => c.replace(/[^a-zA-Z0-9_]/g, '')).join(', ');

    const query = `INSERT INTO ${safeTable} (${safeCols}) VALUES (${placeholders})`;
    await client.query(query, values);

    const selectResult = await client.query(`SELECT * FROM ${safeTable} WHERE id = ?`, [id]);
    if (selectResult && (selectResult as unknown[]).length > 0) {
      results.push(processRow((selectResult as Record<string, unknown>[])[0]));
    }
  }

  return results;
}

async function handleUpdate(
  client: Client,
  table: string,
  data: Record<string, unknown>,
  filters: FilterCondition[]
): Promise<Record<string, unknown>[]> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const { sql: whereClause, values: whereValues } = buildWhereClause(filters);

  const setCols = Object.keys(data).filter(k => data[k] !== undefined);
  const setValues = setCols.map(k => {
    const val = data[k];
    if (typeof val === 'object' && val !== null) {
      return JSON.stringify(val);
    }
    return val;
  });
  const setClause = setCols.map(c => `${c.replace(/[^a-zA-Z0-9_]/g, '')} = ?`).join(', ');

  const query = `UPDATE ${safeTable} SET ${setClause}${whereClause}`;
  await client.query(query, [...setValues, ...whereValues]);

  const selectQuery = `SELECT * FROM ${safeTable}${whereClause}`;
  const result = await client.query(selectQuery, whereValues);
  return (result as Record<string, unknown>[]).map(processRow);
}

async function handleDelete(
  client: Client,
  table: string,
  filters: FilterCondition[]
): Promise<void> {
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const { sql: whereClause, values } = buildWhereClause(filters);

  const query = `DELETE FROM ${safeTable}${whereClause}`;
  await client.query(query, values);
}

async function initializeSchema(client: Client): Promise<void> {
  const statements = SCHEMA_SQL.split(';').filter(s => s.trim());
  for (const statement of statements) {
    if (statement.trim()) {
      await client.query(statement.trim() + ';');
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body: QueryRequest = await req.json();
    const { config, operation, table, columns, data, filters, orderBy, limit } = body;

    if (!config || !config.host || !config.database || !config.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid database configuration' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const client = await getConnection(config);

    try {
      if (operation === 'test') {
        await client.query('SELECT 1');
        return new Response(
          JSON.stringify({ success: true }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (operation === 'initialize') {
        await initializeSchema(client);
        return new Response(
          JSON.stringify({ success: true }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (!table) {
        return new Response(
          JSON.stringify({ error: 'Table name is required' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      let result: unknown = null;

      switch (operation) {
        case 'select':
          result = await handleSelect(client, table, columns || '*', filters || [], orderBy || [], limit ?? null);
          break;
        case 'insert':
          if (!data) {
            throw new Error('Data is required for insert operation');
          }
          result = await handleInsert(client, table, data);
          break;
        case 'update':
          if (!data) {
            throw new Error('Data is required for update operation');
          }
          result = await handleUpdate(client, table, data as Record<string, unknown>, filters || []);
          break;
        case 'delete':
          await handleDelete(client, table, filters || []);
          result = [];
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      return new Response(
        JSON.stringify({ data: result }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error('MySQL Proxy Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
