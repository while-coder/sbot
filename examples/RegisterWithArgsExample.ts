/**
 * Container.registerWithArgs 使用示例
 * 展示如何使用类型匹配自动注入自定义参数
 */

import { Container, singleton } from "../src/Core";
import { LoggerService } from "../src/LoggerService";

const logger = LoggerService.getLogger("RegisterWithArgsExample");

// ============================================================
// 示例场景：数据库服务需要 host, port 和 logger
// ============================================================

interface ILogger {
  log(message: string): void;
}

@singleton()
class ConsoleLogger implements ILogger {
  log(message: string): void {
    console.log(`[ConsoleLogger] ${message}`);
  }
}

// 数据库服务：需要 host (string), port (number), logger (ILogger)
class DatabaseService {
  constructor(
    private host: string,
    private port: number,
    private logger: ILogger
  ) {}

  connect(): void {
    this.logger.log(`正在连接数据库: ${this.host}:${this.port}`);
  }

  getConnectionInfo(): string {
    return `${this.host}:${this.port}`;
  }
}

// API 服务：需要 baseURL (string), timeout (number), dbService (DatabaseService)
class ApiService {
  constructor(
    private baseURL: string,
    private timeout: number,
    private dbService: DatabaseService
  ) {}

  getInfo(): string {
    return `API: ${this.baseURL}, Timeout: ${this.timeout}ms, DB: ${this.dbService.getConnectionInfo()}`;
  }
}

async function main() {
  console.log("🔧 registerWithArgs 使用示例\n");

  const container = new Container();

  // ============================================================
  // 示例 1: 提供部分参数，其他参数通过容器解析
  // ============================================================
  console.log("📦 [示例 1] 提供 host 和 port，logger 通过容器解析\n");

  // 先注册 logger（这样 DatabaseService 的 logger 参数可以通过容器解析）
  container.registerSingleton(ConsoleLogger);

  // 使用 registerWithArgs 创建 DatabaseService，提供 host 和 port
  // logger 会自动从容器解析
  await container.registerWithArgs(
    DatabaseService,
    "localhost",  // host: string
    5432          // port: number
    // logger 会自动从容器解析
  );

  const db1 = await container.resolve(DatabaseService);
  db1.connect();
  console.log(`  ✅ 数据库连接信息: ${db1.getConnectionInfo()}\n`);

  // ============================================================
  // 示例 2: 提供全部参数（不使用容器解析）
  // ============================================================
  console.log("📦 [示例 2] 提供所有参数\n");

  const container2 = new Container();
  const customLogger = new ConsoleLogger();

  // 提供所有参数，完全不依赖容器解析
  await container2.registerWithArgs(
    DatabaseService,
    "192.168.1.100",  // host: string
    3306,             // port: number
    customLogger      // logger: ILogger
  );

  const db2 = await container2.resolve(DatabaseService);
  db2.connect();
  console.log(`  ✅ 数据库连接信息: ${db2.getConnectionInfo()}\n`);

  // ============================================================
  // 示例 3: 参数顺序无关（类型匹配）
  // ============================================================
  console.log("📦 [示例 3] 参数顺序无关，根据类型自动匹配\n");

  const container3 = new Container();
  const logger3 = new ConsoleLogger();

  // 参数顺序不同，但会根据类型自动匹配
  await container3.registerWithArgs(
    DatabaseService,
    5432,             // port: number（顺序与构造函数不同）
    logger3,          // logger: ILogger
    "localhost"       // host: string
  );

  const db3 = await container3.resolve(DatabaseService);
  db3.connect();
  console.log(`  ✅ 数据库连接信息: ${db3.getConnectionInfo()}\n`);

  // ============================================================
  // 示例 4: 复杂场景 - 依赖链
  // ============================================================
  console.log("📦 [示例 4] 依赖链 - ApiService 依赖 DatabaseService\n");

  const container4 = new Container();
  container4.registerSingleton(ConsoleLogger);

  // 创建 DatabaseService（提供 host 和 port）
  await container4.registerWithArgs(
    DatabaseService,
    "db.example.com",
    5432
  );

  // 创建 ApiService（提供 baseURL 和 timeout）
  // dbService 会从容器中解析（前面已经注册）
  await container4.registerWithArgs(
    ApiService,
    "https://api.example.com",  // baseURL: string
    3000                          // timeout: number
    // dbService 自动从容器解析
  );

  const api = await container4.resolve(ApiService);
  console.log(`  ✅ ${api.getInfo()}\n`);

  // ============================================================
  // 示例 5: 基本类型匹配
  // ============================================================
  console.log("📦 [示例 5] 基本类型匹配（String, Number, Boolean）\n");

  class ConfigService {
    constructor(
      private apiKey: string,
      private maxRetries: number,
      private debugMode: boolean
    ) {}

    getConfig(): string {
      return `API Key: ${this.apiKey.substring(0, 10)}..., Retries: ${this.maxRetries}, Debug: ${this.debugMode}`;
    }
  }

  const container5 = new Container();

  // 提供不同顺序的基本类型参数
  await container5.registerWithArgs(
    ConfigService,
    true,                          // debugMode: boolean
    "sk-1234567890abcdef",         // apiKey: string
    5                               // maxRetries: number
  );

  const config = await container5.resolve(ConfigService);
  console.log(`  ✅ ${config.getConfig()}\n`);

  // ============================================================
  // 示例 6: 混合使用 - 部分参数 + 容器解析
  // ============================================================
  console.log("📦 [示例 6] 混合使用 - 只提供难以通过容器解析的参数\n");

  class EmailService {
    constructor(
      private smtpHost: string,
      private smtpPort: number,
      private logger: ILogger,
      private dbService: DatabaseService
    ) {}

    getInfo(): string {
      return `SMTP: ${this.smtpHost}:${this.smtpPort}, DB: ${this.dbService.getConnectionInfo()}`;
    }
  }

  const container6 = new Container();
  container6.registerSingleton(ConsoleLogger);

  await container6.registerWithArgs(
    DatabaseService,
    "db.example.com",
    5432
  );

  // 只提供 SMTP 配置，logger 和 dbService 从容器解析
  await container6.registerWithArgs(
    EmailService,
    "smtp.example.com",  // smtpHost
    587                   // smtpPort
    // logger 和 dbService 自动从容器解析
  );

  const emailService = await container6.resolve(EmailService);
  console.log(`  ✅ ${emailService.getInfo()}\n`);

  console.log("✨ 示例完成！");
}

// 运行示例
if (require.main === module) {
  main().catch(error => {
    console.error("❌ 错误:", error.message);
    console.error(error.stack);
  });
}

export { main };
