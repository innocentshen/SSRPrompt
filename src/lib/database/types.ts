export type DatabaseProvider = 'supabase' | 'mysql';

export interface DatabaseConfig {
  provider: DatabaseProvider;
  mysql?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
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
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
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
}
