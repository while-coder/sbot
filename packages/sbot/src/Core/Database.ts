import { DataTypes, type FindOptions, type ModelStatic, type UpdateOptions, Sequelize } from "sequelize";
import { sleep } from "scorpio.ai/Core";
import { config } from "./Config";
import { LoggerService } from "./LoggerService";

const logger = LoggerService.getLogger("Database.ts");
const DBVersionName = "db_version";
const DBVersion: string = config.pkg.version;
export type MessageRow = {
  id: string;
  expireTime: number;
};

// ── threadId 工厂函数 ──

/** 频道模式 threadId */
export function channelThreadId(channelType: string, channelId: string, sessionId: string): string {
  return `${channelType}_${channelId}_${sessionId}`
}

export type SchedulerRow = {
  id: number;
  expr: string;                    // cron 表达式，如 "0 9 * * *"
  message: string;                 // 消息文本
  targetId: string | null;         // channel_session.id (string)
  aiProcess: boolean;              // true=交给AI处理后回复, false=直接发送原文不经AI
  lastRun: number | null;          // 上次执行时间戳
  nextRun: number | null;          // 下次预计执行时间戳
  runCount: number;                // 已执行次数
  maxRuns: number;                 // 最大执行次数（0 表示不限制）
  disabled: boolean;               // 是否已禁用（软删除）
};

export type TodoRow = {
  id: number;
  targetId: string | null;
  content: string;
  status: string;
  priority: string;
  deadline: number | null;
  schedulerId: number | null;
  doneAt: number | null;
  createdAt: number;
};

export type StateRow = {
  key: string;
  value: string;
};

export type ChannelUserRow = {
  id: number;
  channelId: string; // 频道唯一ID
  userId: string;    // 用户唯一ID
  userName: string;  // 用户名字
  avatar: string;    // 用户头像
  userInfo: string;  // 用户信息
};

export type ChannelSessionRow = {
  // ── 会话标识 ──
  id: number;
  channelId: string;
  sessionId: string;
  sessionName: string;
  avatar: string;

  // ── 可覆盖 ChannelConfig 默认值的字段（null = 使用频道默认值） ──
  agentId: string | null;
  saver: string | null;
  memories: string | null;           // JSON 字符串，使用 parseMemories() 解析
  wikis: string | null;              // JSON 字符串，使用 parseMemories() 解析
  workPath: string | null;
  streamVerbose: boolean | null;
  autoApproveAllTools: boolean | null;
  intentModel: string | null;
  intentPrompt: string | null;
  intentThreshold: number | null;

  // ── 会话自有字段 ──
  useChannelMemories: boolean;       // 是否合并渠道级 memories
  useChannelWikis: boolean;          // 是否合并渠道级 wikis

  // ── 运行时统计 ──
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastTotalTokens: number;
  createdAt: number;
};

export type UsageStatsRow = {
  id: number;
  date: string;           // 日期，如 "2026-04-13"
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type ThreadUsage = {
  inputTokens: number; outputTokens: number; totalTokens: number;
  lastInputTokens: number; lastOutputTokens: number; lastTotalTokens: number;
};

/** 解析 DB 中存储的 memories 字段（JSON 字符串 → string[]） */
export function parseMemories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [];
  }
}

class Database {
  private running = false;
  private dbConfig: {
    type: "sqlite";
    storage: string;
  } | null = null;

  public sequelize!: Sequelize;

  public message!: ModelStatic<any>;
  public state!: ModelStatic<any>;
  public channelUser!: ModelStatic<any>;
  public channelSession!: ModelStatic<any>;
  public scheduler!: ModelStatic<any>;
  public usageStats!: ModelStatic<any>;
  public todo!: ModelStatic<any>;

  async init() {
    this.running = false;

    // 获取数据库文件路径
    const dbStorage = config.getConfigPath("database.sqlite");

    this.dbConfig = {
      type: "sqlite",
      storage: dbStorage,
    };

    logger.info(`Database config: ${JSON.stringify(this.dbConfig)}`);

    const sequelize = new Sequelize({
      dialect: "sqlite",
      storage: dbStorage,
      logging: false,
      retry: {
        match: [/SQLITE_BUSY/],
        name: "query",
        max: 5,
      },
      pool: {
        max: 5,
        min: 0,
        idle: 20000,
      },
      query: {
        raw: true,
      },
      define: {
        timestamps: false,
      },
    });

    this.sequelize = sequelize;

    this.message = sequelize.define(
      "message",
      {
        id: {
          type: DataTypes.STRING(255),
          primaryKey: true,
          comment: "ID",
        },
        expireTime: {
          type: DataTypes.BIGINT,
          comment: "过期时间",
        },
      },
      {
        tableName: "message",
        timestamps: false,
        comment: "事件表",
      },
    );

    this.state = sequelize.define(
      "state",
      {
        key: {
          type: DataTypes.STRING(255),
          primaryKey: true,
          comment: "Key",
        },
        value: {
          type: DataTypes.STRING(255),
          allowNull: false,
          comment: "Value",
        },
      },
      {
        tableName: "state",
        comment: "状态表",
        timestamps: false,
      },
    );

    this.channelUser = sequelize.define(
      "channel_user",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          comment: "自增ID",
        },
        channelId: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: "",
          comment: "频道唯一ID",
        },
        userId: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "用户ID",
        },
        userName: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "用户名",
        },
        avatar: {
          type: DataTypes.STRING(512),
          allowNull: false,
          defaultValue: "",
          comment: "用户头像URL",
        },
        userInfo: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: "",
          comment: "用户信息JSON",
        },
      },
      {
        tableName: "channel_user",
        timestamps: false,
        comment: "用户表",
      },
    );

    this.channelSession = sequelize.define(
      "channel_session",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          comment: "自增ID",
        },
        channelId: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: "",
          comment: "频道唯一ID",
        },
        sessionId: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: "",
          comment: "会话唯一ID",
        },
        sessionName: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "会话名称",
        },
        avatar: {
          type: DataTypes.STRING(512),
          allowNull: false,
          defaultValue: "",
          comment: "会话头像URL",
        },
        agentId: {
          type: DataTypes.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: "Agent UUID，null = 使用 ChannelConfig 默认值",
        },
        saver: {
          type: DataTypes.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: "Saver UUID，null = 使用 ChannelConfig 默认值",
        },
        memories: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "Memory UUID 列表（JSON 字符串，读取时用 parseMemories() 解析）",
        },
        wikis: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "Wiki UUID 列表（JSON 字符串）",
        },
        useChannelMemories: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment: "是否使用渠道级记忆",
        },
        useChannelWikis: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment: "是否使用渠道级知识库",
        },
        workPath: {
          type: DataTypes.STRING(1024),
          allowNull: true,
          defaultValue: null,
          comment: "工作目录路径",
        },
        intentModel: {
          type: DataTypes.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: "意图识别模型 UUID，非空即启用意图过滤",
        },
        intentPrompt: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "自定义意图过滤 prompt，null 使用内置默认",
        },
        intentThreshold: {
          type: DataTypes.FLOAT,
          allowNull: true,
          defaultValue: null,
          comment: "意图识别置信度阈值 (0-1)，null = 使用 ChannelConfig 默认值",
        },
        streamVerbose: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: null,
          comment: "是否输出中间消息和流式输出，null = 使用 ChannelConfig 默认值",
        },
        autoApproveAllTools: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: null,
          comment: "是否自动批准所有工具，null = 使用 ChannelConfig 默认值",
        },
        inputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "累计输入 token 数",
        },
        outputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "累计输出 token 数",
        },
        totalTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "累计总 token 数",
        },
        lastInputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "最后一次输入 token 数",
        },
        lastOutputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "最后一次输出 token 数",
        },
        lastTotalTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "最后一次总 token 数",
        },
        createdAt: {
          type: DataTypes.BIGINT,
          allowNull: false,
          defaultValue: 0,
          comment: "创建时间戳(ms)",
        },
      },
      {
        tableName: "channel_session",
        timestamps: false,
        comment: "频道会话表",
      },
    );

    this.scheduler = sequelize.define(
      "scheduler",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          comment: "自增ID",
        },
        expr: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: "",
          comment: "cron 表达式",
        },
        message: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: "",
          comment: "发送的文字消息",
        },
        targetId: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "目标 channel_session.id",
        },
        aiProcess: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
          comment: "true=交给AI处理后回复, false=直接发送原文",
        },
        lastRun: {
          type: DataTypes.BIGINT,
          allowNull: true,
          defaultValue: null,
          comment: "上次执行时间戳",
        },
        runCount: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "已执行次数",
        },
        nextRun: {
          type: DataTypes.BIGINT,
          allowNull: true,
          defaultValue: null,
          comment: "下次预计执行时间戳",
        },
        maxRuns: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "最大执行次数（0 表示不限制）",
        },
        disabled: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment: "是否已禁用（软删除）",
        },
      },
      {
        tableName: "scheduler",
        timestamps: false,
        comment: "计时器表",
      },
    );

    this.todo = sequelize.define(
      "todo",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          comment: "自增ID",
        },
        targetId: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "目标 channel_session.id",
        },
        content: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: "",
          comment: "任务描述",
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: "pending",
          comment: "任务状态 (pending | done)",
        },
        priority: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: "normal",
          comment: "优先级 (low | normal | high)",
        },
        deadline: {
          type: DataTypes.BIGINT,
          allowNull: true,
          defaultValue: null,
          comment: "截止时间戳(ms)",
        },
        schedulerId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
          comment: "关联的 scheduler.id（deadline 提醒）",
        },
        doneAt: {
          type: DataTypes.BIGINT,
          allowNull: true,
          defaultValue: null,
          comment: "完成时间戳(ms)",
        },
        createdAt: {
          type: DataTypes.BIGINT,
          allowNull: false,
          defaultValue: 0,
          comment: "创建时间戳(ms)",
        },
      },
      {
        tableName: "todo",
        timestamps: false,
        comment: "待办任务表",
      },
    );

    this.usageStats = sequelize.define(
      "usage_stats",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          comment: "自增ID",
        },
        date: {
          type: DataTypes.STRING(10),
          allowNull: false,
          unique: true,
          comment: "日期，如 2026-04-13",
        },
        inputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "输入 token 数",
        },
        outputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "输出 token 数",
        },
        totalTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "总 token 数",
        },
        cacheCreationTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "缓存创建 token 数",
        },
        cacheReadTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "缓存命中 token 数",
        },
      },
      {
        tableName: "usage_stats",
        timestamps: false,
        comment: "每日 Token 用量统计表",
      },
    );

    await this.sync();
  }

  get DBConfig() {
    return this.dbConfig;
  }

  async end() {
    this.running = false;
  }

  private async wait() {
    if (this.dbConfig?.type === "sqlite") {
      while (this.running) {
        await sleep(1);
      }
      this.running = true;
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await this.wait();
      return await fn();
    } finally {
      this.running = false;
    }
  }

  async sync() {
    return this.withLock(async () => {
      await this.state.sync({ alter: true });

      const [data] = await this.state.findOrCreate({
        where: { key: DBVersionName },
        defaults: { value: "" },
      });

      const alter = data.value !== DBVersion;
      logger.info(`Syncing database schema alter:${alter} ${data.value} -> ${DBVersion}`);

      await this.message.sync({ alter });
      await this.channelUser.sync({ alter });
      await this.channelSession.sync({ alter });
      await this.scheduler.sync({ alter });
      await this.todo.sync({ alter });
      await this.usageStats.sync({ alter });

      await this.state.update({ value: DBVersion }, { where: { key: DBVersionName } });
      logger.info("Database schema sync completed");
    });
  }

  async findAll<T>(db: ModelStatic<any>, options?: FindOptions): Promise<T[]> {
    return this.withLock(() => db.findAll(options));
  }

  // 返回值 [返回数据,是否创建了新数据]
  async findOrCreate<T>(db: ModelStatic<any>, options: any): Promise<[T, boolean]> {
    return this.withLock(() => db.findOrCreate(options));
  }

  // 返回值 数据  find by primary key
  async findByPk<T>(db: ModelStatic<any>, key: any): Promise<T | null> {
    return this.withLock(() => db.findByPk(key));
  }

  /// 返回值 数据
  async findOne<T>(db: ModelStatic<any>, options?: FindOptions): Promise<T | null> {
    return this.withLock(() => db.findOne(options));
  }

  // 返回值 创建的数据
  async create<T>(db: ModelStatic<any>, value: any): Promise<T> {
    return this.withLock(() => db.create(value));
  }

  async count(db: ModelStatic<any>, options?: FindOptions) {
    return this.withLock(() => db.count(options));
  }

  // 返回值,只有一个值的数组 [更新行数]
  async update(db: ModelStatic<any>, value: any, options: UpdateOptions<any>) {
    return this.withLock(() => db.update(value, options));
  }

  // 返回值 [返回数据,是否创建了新数据]
  async upsert<T>(db: ModelStatic<any>, value: any, options?: any): Promise<[T, boolean | null]> {
    return this.withLock(() => db.upsert(value, options));
  }

  async destroy(db: ModelStatic<any>, options?: any) {
    return this.withLock(() => db.destroy(options));
  }

  async query(sql: string, options?: any) {
    return this.withLock(() => this.sequelize.query(sql, options));
  }

  async loadThreadUsages(channelThreadIds: string[]): Promise<Record<string, ThreadUsage>> {
    const result: Record<string, ThreadUsage> = {};
    const pick = (r: any): ThreadUsage => ({
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, totalTokens: r.totalTokens,
      lastInputTokens: r.lastInputTokens, lastOutputTokens: r.lastOutputTokens, lastTotalTokens: r.lastTotalTokens,
    });
    for (const tid of channelThreadIds) {
      const parts = tid.split('_');
      if (parts.length < 3) continue;
      const sessionId = parts[parts.length - 1];
      const channelId = parts.slice(1, -1).join('_');
      const row = await this.findOne<ChannelSessionRow>(this.channelSession, { where: { channelId, sessionId } });
      if (row) result[tid] = pick(row);
    }
    return result;
  }
}
export const database = new Database();
