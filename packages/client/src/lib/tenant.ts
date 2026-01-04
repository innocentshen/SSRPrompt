/**
 * 租户/空间管理工具
 * - Demo 空间：使用环境变量中的数据库配置，用于快速体验
 * - 个人空间：用户自行配置数据库，数据完全私有
 */

export type TenantType = 'demo' | 'personal';

const TENANT_KEY = 'tenant_type';
const DEMO_USER_KEY = 'demo_user_id';

/**
 * 获取当前租户类型
 */
export function getTenantType(): TenantType | null {
  const type = localStorage.getItem(TENANT_KEY);
  if (type === 'demo' || type === 'personal') {
    return type;
  }
  return null;
}

/**
 * 设置租户类型
 */
export function setTenantType(type: TenantType): void {
  localStorage.setItem(TENANT_KEY, type);
}

/**
 * 清除租户类型（用于退出/切换空间）
 */
export function clearTenantType(): void {
  localStorage.removeItem(TENANT_KEY);
}

/**
 * 判断是否为 Demo 模式
 */
export function isDemoMode(): boolean {
  return getTenantType() === 'demo';
}

/**
 * 获取 Demo 用户唯一标识
 * 如果不存在则自动生成并缓存
 * 生成有效的 UUID 格式，兼容数据库
 */
export function getDemoUserId(): string {
  let userId = localStorage.getItem(DEMO_USER_KEY);

  if (!userId) {
    // 生成完整的 UUID 格式，数据库兼容
    userId = crypto.randomUUID();
    localStorage.setItem(DEMO_USER_KEY, userId);
  }

  return userId;
}

/**
 * 获取当前用户 ID
 * Demo 模式返回生成的 demo user id，否则返回默认值
 */
export function getCurrentUserId(): string {
  if (isDemoMode()) {
    return getDemoUserId();
  }
  return localStorage.getItem('current_user_id') || 'default';
}

/**
 * 获取 Demo 数据库配置
 * 从环境变量读取配置，支持 Supabase 和 MySQL
 */
export function getDemoDbConfig() {
  const provider = import.meta.env.VITE_DEMO_DB_PROVIDER || 'supabase';

  if (provider === 'mysql') {
    return {
      provider: 'mysql' as const,
      mysql: {
        host: import.meta.env.VITE_DEMO_MYSQL_HOST || '',
        port: parseInt(import.meta.env.VITE_DEMO_MYSQL_PORT || '3306'),
        database: import.meta.env.VITE_DEMO_MYSQL_DATABASE || '',
        user: import.meta.env.VITE_DEMO_MYSQL_USER || '',
        password: import.meta.env.VITE_DEMO_MYSQL_PASSWORD || '',
      }
    };
  }

  // 默认 Supabase
  return {
    provider: 'supabase' as const,
    supabase: {
      url: import.meta.env.VITE_DEMO_SUPABASE_URL || '',
      anonKey: import.meta.env.VITE_DEMO_SUPABASE_ANON_KEY || '',
    }
  };
}

/**
 * 检查 Demo 数据库配置是否有效
 */
export function isDemoDbConfigured(): boolean {
  const config = getDemoDbConfig();

  if (config.provider === 'mysql') {
    return !!(config.mysql?.host && config.mysql?.database);
  }

  return !!(config.supabase?.url && config.supabase?.anonKey);
}

/**
 * Demo 设置密码
 */
export function getDemoSettingsPassword(): string {
  return import.meta.env.VITE_DEMO_SETTINGS_PASSWORD || 'babamama2222@';
}

/**
 * 验证 Demo 设置密码
 */
export function verifyDemoSettingsPassword(password: string): boolean {
  return password === getDemoSettingsPassword();
}
