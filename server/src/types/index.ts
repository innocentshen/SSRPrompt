export interface MySQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface FilterCondition {
  column: string;
  operator: string;
  value: unknown;
}

export interface SingleQueryRequest {
  table: string;
  columns?: string;
  filters?: FilterCondition[];
  orderBy?: { column: string; ascending: boolean }[];
  limit?: number | null;
  offset?: number | null;
}

export interface BatchQueryRequest {
  queries: {
    key: string;  // 用于标识结果的键名
    table: string;
    columns?: string;
    filters?: FilterCondition[];
    orderBy?: { column: string; ascending: boolean }[];
    limit?: number | null;
    offset?: number | null;
  }[];
}

export interface QueryRequest {
  config: MySQLConfig;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'test' | 'initialize' | 'get_schema_version' | 'execute_sql' | 'batch' | 'evaluation_details';
  table?: string;
  columns?: string;
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: FilterCondition[];
  orderBy?: { column: string; ascending: boolean }[];
  limit?: number | null;
  offset?: number | null;
  singleRow?: boolean;
  sql?: string; // 用于 execute_sql 操作
  batch?: BatchQueryRequest; // 用于 batch 操作
  evaluationId?: string; // 用于 evaluation_details 操作
}
