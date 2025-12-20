import type { DatabaseService, QueryBuilder, QueryResult } from './types';

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

  constructor(
    private table: string,
    private config: MySQLConfig,
    private edgeFunctionUrl: string
  ) {}

  select(columns: string = '*'): QueryBuilder<T> {
    this._operation = 'select';
    this._columns = columns;
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

  private async executeQuery<R>(singleRow: boolean = false): Promise<QueryResult<R>> {
    try {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
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

  constructor(config: MySQLConfig) {
    this.config = config;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    this.edgeFunctionUrl = `${supabaseUrl}/functions/v1/mysql-proxy`;
  }

  from<T>(table: string): QueryBuilder<T> {
    return new MySQLQueryBuilder<T>(table, this.config, this.edgeFunctionUrl);
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    try {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
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
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
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
}
