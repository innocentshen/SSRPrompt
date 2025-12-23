import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { DatabaseService, QueryBuilder, QueryResult, SupabaseConfig, Migration, MigrationResult } from './types';

type FilterMethod = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
type FilterDef = { method: FilterMethod; column: string; value: unknown };
type OrderDef = { column: string; ascending: boolean };

class SupabaseQueryBuilder<T> implements QueryBuilder<T> {
  private client: SupabaseClient;
  private table: string;
  private _columns: string = '*';
  private _operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private _data: Partial<T> | Partial<T>[] | null = null;
  private _filters: FilterDef[] = [];
  private _orders: OrderDef[] = [];
  private _limit: number | null = null;
  private _returnData: boolean = false; // 标记是否在 insert/update 后返回数据

  constructor(client: SupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select(columns: string = '*'): QueryBuilder<T> {
    // 如果已经是 insert 或 update 操作，不覆盖 _operation
    // 只设置 _returnData 标志和 columns
    if (this._operation === 'insert' || this._operation === 'update') {
      this._returnData = true;
      this._columns = columns;
    } else {
      this._operation = 'select';
      this._columns = columns;
    }
    return this;
  }

  insert(data: Partial<T> | Partial<T>[]): QueryBuilder<T> {
    this._operation = 'insert';
    this._data = data;
    return this;
  }

  update(data: Partial<T>): QueryBuilder<T> {
    this._operation = 'update';
    this._data = data;
    return this;
  }

  delete(): QueryBuilder<T> {
    this._operation = 'delete';
    return this;
  }

  eq(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ method: 'eq', column, value });
    return this;
  }

  neq(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ method: 'neq', column, value });
    return this;
  }

  gt(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ method: 'gt', column, value });
    return this;
  }

  gte(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ method: 'gte', column, value });
    return this;
  }

  lt(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ method: 'lt', column, value });
    return this;
  }

  lte(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ method: 'lte', column, value });
    return this;
  }

  in(column: string, values: unknown[]): QueryBuilder<T> {
    this._filters.push({ method: 'in', column, value: values });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T> {
    this._orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): QueryBuilder<T> {
    this._limit = count;
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyFiltersAndModifiers(query: any): any {
    let q = query;
    for (const filter of this._filters) {
      if (filter.method === 'in') {
        q = q.in(filter.column, filter.value as unknown[]);
      } else {
        q = q[filter.method](filter.column, filter.value);
      }
    }
    for (const order of this._orders) {
      q = q.order(order.column, { ascending: order.ascending });
    }
    if (this._limit !== null) {
      q = q.limit(this._limit);
    }
    return q;
  }

  async single(): Promise<QueryResult<T>> {
    if (this._operation === 'insert') {
      const insertData = Array.isArray(this._data) ? this._data[0] : this._data;
      const result = await this.client.from(this.table).insert(insertData as never).select().single();
      return {
        data: result.data as T | null,
        error: result.error ? new Error(result.error.message) : null,
      };
    }
    if (this._operation === 'update') {
      let query = this.client.from(this.table).update(this._data as never);
      query = this.applyFiltersAndModifiers(query);
      const result = await query.select().single();
      return {
        data: result.data as T | null,
        error: result.error ? new Error(result.error.message) : null,
      };
    }
    let query = this.client.from(this.table).select(this._columns);
    query = this.applyFiltersAndModifiers(query);
    const result = await query.single();
    return {
      data: result.data as T | null,
      error: result.error ? new Error(result.error.message) : null,
    };
  }

  async maybeSingle(): Promise<QueryResult<T | null>> {
    if (this._operation === 'insert') {
      const insertData = Array.isArray(this._data) ? this._data[0] : this._data;
      const result = await this.client.from(this.table).insert(insertData as never).select().maybeSingle();
      return {
        data: result.data as T | null,
        error: result.error ? new Error(result.error.message) : null,
      };
    }
    if (this._operation === 'update') {
      let query = this.client.from(this.table).update(this._data as never);
      query = this.applyFiltersAndModifiers(query);
      const result = await query.select().maybeSingle();
      return {
        data: result.data as T | null,
        error: result.error ? new Error(result.error.message) : null,
      };
    }
    let query = this.client.from(this.table).select(this._columns);
    query = this.applyFiltersAndModifiers(query);
    const result = await query.maybeSingle();
    return {
      data: result.data as T | null,
      error: result.error ? new Error(result.error.message) : null,
    };
  }

  async then<TResult>(
    onfulfilled?: (value: QueryResult<T[]>) => TResult | PromiseLike<TResult>
  ): Promise<TResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;

    switch (this._operation) {
      case 'select': {
        let query = this.client.from(this.table).select(this._columns);
        query = this.applyFiltersAndModifiers(query);
        result = await query;
        break;
      }
      case 'insert': {
        const insertData = Array.isArray(this._data) ? this._data : [this._data];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await this.client.from(this.table).insert(insertData as any).select();
        break;
      }
      case 'update': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query = this.client.from(this.table).update(this._data as any);
        query = this.applyFiltersAndModifiers(query);
        result = await query.select();
        break;
      }
      case 'delete': {
        let query = this.client.from(this.table).delete();
        query = this.applyFiltersAndModifiers(query);
        result = await query;
        break;
      }
      default:
        result = { data: null, error: { message: 'Unknown operation' } };
    }

    const queryResult: QueryResult<T[]> = {
      data: result.data as T[] | null,
      error: result.error ? new Error(result.error.message) : null,
    };

    if (onfulfilled) {
      return onfulfilled(queryResult);
    }
    return queryResult as TResult;
  }
}

export class SupabaseAdapter implements DatabaseService {
  private client: SupabaseClient;
  private config: SupabaseConfig;

  constructor(config?: SupabaseConfig) {
    // 优先使用传入的配置，否则从环境变量读取
    const supabaseUrl = config?.url || import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase 配置缺失，请提供 URL 和 Anon Key');
    }

    this.config = { url: supabaseUrl, anonKey: supabaseAnonKey };
    this.client = createClient(supabaseUrl, supabaseAnonKey);
  }

  from<T>(table: string): QueryBuilder<T> {
    return new SupabaseQueryBuilder<T>(this.client, table);
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    // Supabase 表结构通过 migration 管理，这里只验证连接
    return this.testConnection();
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.client.from('providers').select('id').limit(1);
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getConfig(): SupabaseConfig {
    return this.config;
  }

  async getSchemaVersion(): Promise<number> {
    try {
      // 尝试查询 schema_migrations 表获取最高版本
      const { data, error } = await this.client
        .from('schema_migrations')
        .select('version')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        // 表可能不存在，返回 0
        console.log('schema_migrations table may not exist:', error.message);
        return 0;
      }

      return data?.version || 0;
    } catch {
      return 0;
    }
  }

  async runMigrations(migrations: Migration[]): Promise<MigrationResult> {
    const executedMigrations: number[] = [];
    let currentVersion = await this.getSchemaVersion();

    try {
      for (const migration of migrations) {
        // 对于 Supabase，由于无法直接执行 DDL，我们需要用户手动执行
        // 这里只记录版本号
        const result = await this.executeSql(migration.postgresql);
        if (!result.success) {
          return {
            success: false,
            executedMigrations,
            currentVersion,
            error: `Migration v${migration.version} failed: ${result.error}`
          };
        }

        // 记录迁移版本
        const { error: insertError } = await this.client
          .from('schema_migrations')
          .upsert({ version: migration.version, name: migration.name });

        if (insertError) {
          return {
            success: false,
            executedMigrations,
            currentVersion,
            error: `Failed to record migration v${migration.version}: ${insertError.message}`
          };
        }

        executedMigrations.push(migration.version);
        currentVersion = migration.version;
      }

      return {
        success: true,
        executedMigrations,
        currentVersion
      };
    } catch (e) {
      return {
        success: false,
        executedMigrations,
        currentVersion,
        error: e instanceof Error ? e.message : 'Unknown error'
      };
    }
  }

  async executeSql(_sql: string): Promise<{ success: boolean; error?: string }> {
    // Supabase 客户端不支持直接执行原生 SQL (DDL)
    // 用户需要在 Supabase Dashboard 的 SQL Editor 中手动执行
    // 这里我们返回一个特殊的提示
    return {
      success: false,
      error: 'Supabase 不支持通过客户端执行 DDL 语句。请在 Supabase Dashboard 的 SQL Editor 中手动执行迁移脚本。'
    };
  }
}
