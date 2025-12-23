import { SupabaseAdapter } from './supabase-adapter';
import { MySQLAdapter } from './mysql-adapter';
import type { DatabaseConfig, DatabaseProvider, DatabaseService } from './types';

export type { DatabaseConfig, DatabaseProvider, DatabaseService, QueryBuilder, QueryResult, SupabaseConfig, MySQLConfig } from './types';

const DB_CONFIG_KEY = 'ai_platform_db_config';

let currentService: DatabaseService | null = null;
let currentConfig: DatabaseConfig = { provider: 'supabase' };

export function getStoredConfig(): DatabaseConfig {
  try {
    const stored = localStorage.getItem(DB_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    console.error('Failed to load database config from storage');
  }
  return { provider: 'supabase' };
}

export function saveConfig(config: DatabaseConfig): void {
  try {
    localStorage.setItem(DB_CONFIG_KEY, JSON.stringify(config));
    currentConfig = config;
  } catch {
    console.error('Failed to save database config to storage');
  }
}

export function getCurrentProvider(): DatabaseProvider {
  return currentConfig.provider;
}

/**
 * 检查数据库是否已配置
 */
export function isDatabaseConfigured(): boolean {
  const config = getStoredConfig();

  if (config.provider === 'mysql') {
    return !!(config.mysql?.host && config.mysql?.database && config.mysql?.user);
  }

  if (config.provider === 'supabase') {
    return !!(config.supabase?.url && config.supabase?.anonKey);
  }

  return false;
}

export function initializeDatabase(config?: DatabaseConfig): DatabaseService {
  if (config) {
    currentConfig = config;
  } else {
    currentConfig = getStoredConfig();
  }

  if (currentConfig.provider === 'mysql' && currentConfig.mysql) {
    currentService = new MySQLAdapter(currentConfig.mysql);
  } else if (currentConfig.provider === 'supabase') {
    // 使用存储的 Supabase 配置或环境变量
    currentService = new SupabaseAdapter(currentConfig.supabase);
  } else {
    // 默认使用 Supabase
    currentService = new SupabaseAdapter();
  }

  return currentService;
}

export function getDatabase(): DatabaseService {
  if (!currentService) {
    return initializeDatabase();
  }
  return currentService;
}

export function getSupabaseClient() {
  const config = getStoredConfig();
  const adapter = new SupabaseAdapter(config.supabase);
  return adapter.getClient();
}
