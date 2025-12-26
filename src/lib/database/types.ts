export type DatabaseProvider = 'supabase' | 'mysql';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface MySQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface DatabaseConfig {
  provider: DatabaseProvider;
  supabase?: SupabaseConfig;
  mysql?: MySQLConfig;
}

export interface QueryResult<T> {
  data: T | null;
  error: Error | null;
}

export interface QueryBuilder<T> {
  select(columns?: string): QueryBuilder<T>;
  insert(data: Partial<T> | Partial<T>[]): QueryBuilder<T>;
  update(data: Partial<T>): QueryBuilder<T>;
  delete(): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  neq(column: string, value: unknown): QueryBuilder<T>;
  gt(column: string, value: unknown): QueryBuilder<T>;
  gte(column: string, value: unknown): QueryBuilder<T>;
  lt(column: string, value: unknown): QueryBuilder<T>;
  lte(column: string, value: unknown): QueryBuilder<T>;
  in(column: string, values: unknown[]): QueryBuilder<T>;
  is(column: string, value: null): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
  range(from: number, to: number): QueryBuilder<T>;
  single(): Promise<QueryResult<T>>;
  maybeSingle(): Promise<QueryResult<T | null>>;
  then<TResult>(
    onfulfilled?: (value: QueryResult<T[]>) => TResult | PromiseLike<TResult>
  ): Promise<TResult>;
}

export interface DatabaseService {
  from<T>(table: string): QueryBuilder<T>;
  initialize(): Promise<{ success: boolean; error?: string }>;
  testConnection(): Promise<{ success: boolean; error?: string }>;
  // 迁移相关方法
  getSchemaVersion(): Promise<number>;
  runMigrations(migrations: Migration[]): Promise<MigrationResult>;
  executeSql(sql: string): Promise<{ success: boolean; error?: string }>;
}

// 迁移系统类型
export interface Migration {
  version: number;
  name: string;
  description: string;
  mysql: string;
  postgresql: string;
}

export interface MigrationResult {
  success: boolean;
  executedMigrations: number[];
  currentVersion: number;
  error?: string;
}

export interface MigrationStatus {
  currentVersion: number;
  latestVersion: number;
  pendingMigrations: Migration[];
  isUpToDate: boolean;
}
