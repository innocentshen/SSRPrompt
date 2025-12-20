import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { DatabaseService, QueryBuilder, QueryResult } from './types';

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

  constructor(client: SupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

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

  constructor() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    this.client = createClient(supabaseUrl, supabaseAnonKey);
  }

  from<T>(table: string): QueryBuilder<T> {
    return new SupabaseQueryBuilder<T>(this.client, table);
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
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
}
