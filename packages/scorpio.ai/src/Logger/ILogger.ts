/**
 * Logger 接口
 * 定义日志实例的基本方法
 */
export interface ILogger {

  /**
   * 记录 debug 级别日志
   */
  debug(message: string, ...args: any[]): void;

  /**
   * 记录 info 级别日志
   */
  info(message: string, ...args: any[]): void;

  /**
   * 记录 warn 级别日志
   */
  warn(message: string, ...args: any[]): void;

  /**
   * 记录 error 级别日志
   */
  error(message: string, ...args: any[]): void;
}