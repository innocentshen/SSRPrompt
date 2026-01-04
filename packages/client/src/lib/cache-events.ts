/**
 * 全局缓存失效事件系统
 * 用于跨页面同步缓存状态
 */

type CacheEventType = 'prompts' | 'models' | 'providers' | 'evaluations';

type CacheEventListener = (type: CacheEventType, data?: unknown) => void;

// 存储待更新的数据（用于精确更新缓存，而不是全量刷新）
interface PendingUpdate {
  type: CacheEventType;
  data: unknown;
}

class CacheEventEmitter {
  private listeners: Set<CacheEventListener> = new Set();
  // 存储待处理的更新（用于页面未挂载时的延迟处理）
  private pendingUpdates: PendingUpdate[] = [];

  /**
   * 订阅缓存失效事件
   */
  subscribe(listener: CacheEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 发布缓存失效事件
   */
  invalidate(type: CacheEventType, data?: unknown): void {
    // 保存待更新的数据
    if (data) {
      this.pendingUpdates.push({ type, data });
    }
    // 通知所有监听器
    this.listeners.forEach((listener) => {
      try {
        listener(type, data);
      } catch (error) {
        console.error('Cache event listener error:', error);
      }
    });
  }

  /**
   * 获取并清除指定类型的待更新数据
   */
  consumePendingUpdates(type: CacheEventType): unknown[] {
    const updates = this.pendingUpdates
      .filter((u) => u.type === type)
      .map((u) => u.data);
    this.pendingUpdates = this.pendingUpdates.filter((u) => u.type !== type);
    return updates;
  }

  /**
   * 检查是否有待处理的更新
   */
  hasPendingUpdates(type: CacheEventType): boolean {
    return this.pendingUpdates.some((u) => u.type === type);
  }
}

// 单例实例
export const cacheEvents = new CacheEventEmitter();

// 便捷方法
export const invalidatePromptsCache = (data?: unknown) => cacheEvents.invalidate('prompts', data);
export const invalidateModelsCache = (data?: unknown) => cacheEvents.invalidate('models', data);
export const invalidateProvidersCache = (data?: unknown) => cacheEvents.invalidate('providers', data);
export const invalidateEvaluationsCache = (data?: unknown) => cacheEvents.invalidate('evaluations', data);
