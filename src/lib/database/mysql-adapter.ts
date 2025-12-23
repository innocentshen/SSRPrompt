import type { DatabaseService, QueryBuilder, QueryResult, Migration, MigrationResult } from './types';

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

class MySQLQueryBuilder<T> implements QueryBuilder<T> {
  private _operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private _columns: string = '*';
  private _data: Partial<T> | Partial<T>[] | null = null;
  private _filters: FilterCondition[] = [];
  private _orderBy: { column: string; ascending: boolean }[] = [];
  private _limit: number | null = null;
  private _returnData: boolean = false; // 标记是否在 insert/update 后返回数据

  constructor(
    private table: string,
    private config: MySQLConfig,
    private edgeFunctionUrl: string,
    private useLocalProxy: boolean
  ) {}

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
    this._filters.push({ column, operator: '=', value });
    return this;
  }

  neq(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ column, operator: '!=', value });
    return this;
  }

  gt(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ column, operator: '>', value });
    return this;
  }

  gte(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ column, operator: '>=', value });
    return this;
  }

  lt(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ column, operator: '<', value });
    return this;
  }

  lte(column: string, value: unknown): QueryBuilder<T> {
    this._filters.push({ column, operator: '<=', value });
    return this;
  }

  in(column: string, values: unknown[]): QueryBuilder<T> {
    this._filters.push({ column, operator: 'IN', value: values });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T> {
    this._orderBy.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): QueryBuilder<T> {
    this._limit = count;
    return this;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.useLocalProxy) {
      const apiKey = import.meta.env.VITE_MYSQL_PROXY_API_KEY;
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
    } else {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (anonKey) {
        headers['Authorization'] = `Bearer ${anonKey}`;
      }
    }

    return headers;
  }

  private async executeQuery<R>(singleRow: boolean = false): Promise<QueryResult<R>> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          config: this.config,
          operation: this._operation,
          table: this.table,
          columns: this._columns,
          data: this._data,
          filters: this._filters,
          orderBy: this._orderBy,
          limit: this._limit,
          singleRow,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { data: null, error: new Error(errorText) };
      }

      const result = await response.json();
      if (result.error) {
        return { data: null, error: new Error(result.error) };
      }

      return { data: result.data as R, error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e : new Error('Unknown error') };
    }
  }

  async single(): Promise<QueryResult<T>> {
    this._limit = 1;
    const result = await this.executeQuery<T[]>(true);
    if (result.error) {
      return { data: null, error: result.error };
    }
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    return { data: data || null, error: null };
  }

  async maybeSingle(): Promise<QueryResult<T | null>> {
    this._limit = 1;
    const result = await this.executeQuery<T[]>(true);
    if (result.error) {
      return { data: null, error: result.error };
    }
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    return { data: data || null, error: null };
  }

  async then<TResult>(
    onfulfilled?: (value: QueryResult<T[]>) => TResult | PromiseLike<TResult>
  ): Promise<TResult> {
    const result = await this.executeQuery<T[]>();
    if (onfulfilled) {
      return onfulfilled(result);
    }
    return result as TResult;
  }
}

export class MySQLAdapter implements DatabaseService {
  private config: MySQLConfig;
  private edgeFunctionUrl: string;
  private useLocalProxy: boolean;

  constructor(config: MySQLConfig) {
    this.config = config;

    // 优先使用本地服务器，回退到 Supabase
    const localServerUrl = import.meta.env.VITE_MYSQL_PROXY_URL;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    if (localServerUrl) {
      this.edgeFunctionUrl = localServerUrl;
      this.useLocalProxy = true;
      console.log('Using local MySQL proxy server:', localServerUrl);
    } else if (supabaseUrl) {
      this.edgeFunctionUrl = `${supabaseUrl}/functions/v1/mysql-proxy`;
      this.useLocalProxy = false;
      console.log('Using Supabase Edge Function:', this.edgeFunctionUrl);
    } else {
      throw new Error('No MySQL proxy configuration found. Please set VITE_MYSQL_PROXY_URL or VITE_SUPABASE_URL');
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.useLocalProxy) {
      const apiKey = import.meta.env.VITE_MYSQL_PROXY_API_KEY;
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
    } else {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (anonKey) {
        headers['Authorization'] = `Bearer ${anonKey}`;
      }
    }

    return headers;
  }

  from<T>(table: string): QueryBuilder<T> {
    return new MySQLQueryBuilder<T>(table, this.config, this.edgeFunctionUrl, this.useLocalProxy);
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          config: this.config,
          operation: 'initialize',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }

      const result = await response.json();
      return result;
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          config: this.config,
          operation: 'test',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }

      const result = await response.json();
      return result;
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async getSchemaVersion(): Promise<number> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          config: this.config,
          operation: 'get_schema_version',
        }),
      });

      if (!response.ok) {
        // 表可能不存在，返回 0
        return 0;
      }

      const result = await response.json();
      return result.version || 0;
    } catch {
      return 0;
    }
  }

  async runMigrations(migrations: Migration[]): Promise<MigrationResult> {
    const executedMigrations: number[] = [];
    let currentVersion = await this.getSchemaVersion();

    try {
      for (const migration of migrations) {
        const result = await this.executeSql(migration.mysql);
        if (!result.success) {
          return {
            success: false,
            executedMigrations,
            currentVersion,
            error: `Migration v${migration.version} failed: ${result.error}`
          };
        }

        // 记录迁移版本
        const recordResult = await this.executeSql(
          `INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, '${migration.name}') ON DUPLICATE KEY UPDATE name = '${migration.name}'`
        );
        if (!recordResult.success) {
          return {
            success: false,
            executedMigrations,
            currentVersion,
            error: `Failed to record migration v${migration.version}: ${recordResult.error}`
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

  async executeSql(sql: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          config: this.config,
          operation: 'execute_sql',
          sql,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }

      const result = await response.json();
      return result;
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }
}
