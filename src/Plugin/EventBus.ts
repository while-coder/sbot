import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("EventBus.ts");

/**
 * 事件处理函数类型
 */
export type EventHandler<T = any> = (data: T) => void | Promise<void>;

/**
 * 事件监听器
 */
interface EventListener {
  handler: EventHandler;
  once: boolean;
}

/**
 * 事件总线
 * 提供发布-订阅模式的事件通信机制
 */
export class EventBus {
  /**
   * 事件监听器映射
   */
  private listeners: Map<string, EventListener[]> = new Map();

  /**
   * 通配符监听器（监听所有事件）
   */
  private wildcardListeners: EventListener[] = [];

  /**
   * 订阅事件
   * @param event 事件名称
   * @param handler 事件处理函数
   * @returns 取消订阅函数
   */
  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    return this.addListener(event, handler, false);
  }

  /**
   * 订阅事件（只触发一次）
   * @param event 事件名称
   * @param handler 事件处理函数
   * @returns 取消订阅函数
   */
  once<T = any>(event: string, handler: EventHandler<T>): () => void {
    return this.addListener(event, handler, true);
  }

  /**
   * 取消订阅事件
   * @param event 事件名称
   * @param handler 事件处理函数（如果不提供则移除该事件的所有监听器）
   */
  off(event: string, handler?: EventHandler): void {
    if (!handler) {
      // 移除该事件的所有监听器
      this.listeners.delete(event);
      logger.debug(`移除事件 ${event} 的所有监听器`);
      return;
    }

    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.findIndex(l => l.handler === handler);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this.listeners.delete(event);
        }
        logger.debug(`移除事件 ${event} 的监听器`);
      }
    }
  }

  /**
   * 发布事件（同步）
   * @param event 事件名称
   * @param data 事件数据
   */
  emit(event: string, data?: any): void {
    this.emitAsync(event, data).catch(error => {
      logger.error(`事件 ${event} 处理失败: ${error.message}`);
    });
  }

  /**
   * 发布事件（异步）
   * @param event 事件名称
   * @param data 事件数据
   */
  async emitAsync(event: string, data?: any): Promise<void> {
    logger.debug(`发布事件: ${event}`);

    const listeners = this.listeners.get(event) || [];
    const allListeners = [...listeners, ...this.wildcardListeners];

    // 执行所有监听器
    for (const listener of allListeners) {
      try {
        await listener.handler(data);

        // 如果是一次性监听器，执行后移除
        if (listener.once) {
          this.off(event, listener.handler);
        }
      } catch (error: any) {
        logger.error(`事件 ${event} 处理器执行失败: ${error.message}`);
      }
    }
  }

  /**
   * 订阅所有事件（通配符）
   * @param handler 事件处理函数
   * @returns 取消订阅函数
   */
  onAny(handler: EventHandler<{ event: string; data: any }>): () => void {
    const listener: EventListener = { handler, once: false };
    this.wildcardListeners.push(listener);

    return () => {
      const index = this.wildcardListeners.indexOf(listener);
      if (index !== -1) {
        this.wildcardListeners.splice(index, 1);
      }
    };
  }

  /**
   * 移除所有事件监听器
   */
  clear(): void {
    this.listeners.clear();
    this.wildcardListeners = [];
    logger.info("已清空所有事件监听器");
  }

  /**
   * 获取事件监听器数量
   * @param event 事件名称（可选，不提供则返回所有事件的监听器总数）
   */
  listenerCount(event?: string): number {
    if (event) {
      return (this.listeners.get(event)?.length || 0) + this.wildcardListeners.length;
    }

    let total = this.wildcardListeners.length;
    for (const listeners of this.listeners.values()) {
      total += listeners.length;
    }
    return total;
  }

  /**
   * 获取所有事件名称
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * 添加监听器
   */
  private addListener(event: string, handler: EventHandler, once: boolean): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const listener: EventListener = { handler, once };
    this.listeners.get(event)!.push(listener);

    logger.debug(`添加事件监听器: ${event}${once ? ' (once)' : ''}`);

    // 返回取消订阅函数
    return () => this.off(event, handler);
  }

  /**
   * 等待事件触发（Promise 风格）
   * @param event 事件名称
   * @param timeout 超时时间（毫秒）
   */
  async waitFor<T = any>(event: string, timeout?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;

      const unsubscribe = this.once(event, (data: T) => {
        if (timer) clearTimeout(timer);
        resolve(data);
      });

      if (timeout) {
        timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`等待事件 ${event} 超时`));
        }, timeout);
      }
    });
  }

  /**
   * 调试信息
   */
  debug(): void {
    console.log("\n=== EventBus 调试信息 ===");
    console.log(`总监听器数: ${this.listenerCount()}`);
    console.log(`通配符监听器: ${this.wildcardListeners.length}`);
    console.log("\n事件监听器:");

    for (const [event, listeners] of this.listeners.entries()) {
      console.log(`  ${event}: ${listeners.length} 个监听器`);
    }

    console.log("\n=======================\n");
  }
}

/**
 * 全局事件总线实例
 */
export const globalEventBus = new EventBus();
