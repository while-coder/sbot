import { DataTypes, type FindOptions, type ModelStatic, type UpdateOptions, Sequelize } from "sequelize";
import { sleep } from "scorpio.ai";
import { ApprovalTimeoutValue } from "sbot.commons";
import { config } from "./Config";
import { LoggerService } from "./LoggerService";

const logger = LoggerService.getLogger("Database.ts");
const DBVersionName = "db_version";
const DBVersion: string = config.pkg.version;
export type MessageRow = {
  id: string;
  expireTime: number;
};

// thread id = String(profile.id)。saver / SessionService Map 都按这个 key 索引。
// 多个 ChannelSession 共享同一 SessionProfile 即共享 thread（跨 channel 也共享）。

// ⚠️ aiProcess / disabled 运行时是 0/1（受 raw:true 影响，见上方 query 配置注释）。
// 仅可用真值检查，禁止 `=== true` / `=== false`。
export type SchedulerRow = {
  id: number;
  expr: string;                    // cron 表达式，如 "0 9 * * *"
  message: string;                 // 消息文本
  targetId: string;                // channel_session.id (string)
  aiProcess: boolean;              // true=交给AI处理后回复, false=直接发送原文不经AI
  lastRun: number | null;          // 上次执行时间戳
  nextRun: number | null;          // 下次预计执行时间戳
  runCount: number;                // 已执行次数
  maxRuns: number;                 // 最大执行次数（0 表示不限制）
  disabled: boolean;               // 是否已禁用（软删除）
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

/**
 * Session 表只保留"标识"信息：
 * - 所有可覆盖配置字段（agent/saver/memories/wikis/...）都在 SessionProfileRow 上
 * - token 统计也在 profile 上（共享 profile 的 session 共享统计）
 * - 每个 session 对应一个 SessionProfile：
 *   - 默认是 auto profile（autoForSessionId == session.id），admin 不可见
 *   - 用户可手动切到一个 visible profile（共享配置 + thread）
 */
export type ChannelSessionRow = {
  id: number;
  channelId: string;
  sessionId: string;
  sessionName: string;          // 用户自定义名（空 = 跟随 autoSessionName）
  autoSessionName: string;      // 渠道自动获取的名字，doInitSession 维护
  avatar: string;
  profileId: number;            // 关联的 SessionProfile（NOT NULL，doInitSession 自动建 auto profile 并指向）
  createdAt: number;
};

/**
 * SessionProfile：会话配置 + thread + token 统计的载体。
 * - autoForSessionId 非 null：此 profile 是某 session 的 auto profile（admin 列表过滤掉）
 * - autoForSessionId 为 null：visible profile，可被多个 session 共享
 * - thread id = String(profile.id)
 *
 * ⚠️ 三态布尔（useChannelMemories/Wikis/streamVerbose/autoApproveAllTools）运行时是 0/1/null。
 */
export type SessionProfileRow = {
  id: number;
  name: string;
  autoForSessionId: number | null;

  // ── 可覆盖 ChannelConfig 默认值的字段（null = 使用频道默认值） ──
  agentId: string | null;
  saver: string | null;
  
  useChannelMemories: boolean | null;
  memories: string | null;           // JSON 字符串
  useChannelWikis: boolean | null;
  wikis: string | null;              // JSON 字符串
  workPath: string | null;
  streamVerbose: boolean | null;
  autoApproveAllTools: boolean | null;
  approvalTimeout: number | null;
  approvalTimeoutValue: ApprovalTimeoutValue | null;
  askTimeout: number | null;
  askTimeoutMessage: string | null;
  intentModel: string | null;
  intentPrompt: string | null;
  intentThreshold: number | null;

  // ── 运行时统计 ──
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastTotalTokens: number;

  createdAt: number;
};


// ⚠️ enabled 运行时是 0/1（受 raw:true 影响，见上方 query 配置注释）。
// 仅可用真值检查，禁止 `=== true` / `=== false`。
export type HeartbeatRow = {
  id: number;
  name: string;
  intervalMinutes: number;
  promptFile: string;
  target: number;
  enabled: boolean;
  activeHoursStart: number | null;
  activeHoursEnd: number | null;
  activeHoursTimezone: string | null;
  lastRun: number | null;
  createdAt: number;
};

export type UsageLogRow = {
  id: number;
  date: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  modelId: string;
  modelName: string;
  provider: string;
  channelId: string;
  sessionId: number;        // channel_session.id，区分发送方
  profileId: number;        // session_profile.id，profile/thread 维度聚合
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
  public sessionProfile!: ModelStatic<any>;
  public scheduler!: ModelStatic<any>;
  public usageLogs!: ModelStatic<any>;
  public heartbeat!: ModelStatic<any>;

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
        // ⚠️ raw: true 让所有 find* 跳过 Sequelize 的类型转换，BOOLEAN 列从 SQLite
        // 直接以 INTEGER 0/1（或 null）返回 —— 不是 false/true。
        // 后果：消费 Row 的代码不能用 `=== true`/`=== false`/`String(v) === "true"`
        // 这类严格比较；用真值检查（`if (v)`、`v ? a : b`、`!!v`）或显式 `Boolean(v)` 归一化。
        // 写回数据库不受影响（Sequelize 在 update/create 仍会校验列类型）。
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
          comment: "用户自定义会话名称（空字符串表示使用 autoSessionName）",
        },
        autoSessionName: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "渠道自动获取的会话名称",
        },
        avatar: {
          type: DataTypes.STRING(512),
          allowNull: false,
          defaultValue: "",
          comment: "会话头像URL",
        },
        profileId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "关联的 SessionProfile.id（doInitSession 自动建 auto profile）",
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
        indexes: [{ fields: ["profileId"] }],
      },
    );

    this.sessionProfile = sequelize.define(
      "session_profile",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          comment: "自增ID",
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "Profile 显示名称（auto profile 可为空）",
        },
        autoForSessionId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
          comment: "非 null = 此 profile 是某 session 的 auto profile（admin 列表过滤掉）",
        },
        agentId: {
          type: DataTypes.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: "Agent UUID，null = 跟随 ChannelConfig",
        },
        saver: {
          type: DataTypes.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: "Saver UUID，null = 跟随 ChannelConfig",
        },
        memories: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "Memory UUID 列表（JSON 字符串）",
        },
        wikis: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "Wiki UUID 列表（JSON 字符串）",
        },
        useChannelMemories: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: null,
          comment: "是否合并渠道级 memories",
        },
        useChannelWikis: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: null,
          comment: "是否合并渠道级 wikis",
        },
        workPath: {
          type: DataTypes.STRING(1024),
          allowNull: true,
          defaultValue: null,
          comment: "工作目录路径",
        },
        streamVerbose: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: null,
          comment: "是否输出中间消息和流式输出",
        },
        autoApproveAllTools: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: null,
          comment: "是否自动批准所有工具",
        },
        approvalTimeout: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
          comment: "Approval 等待超时（秒）",
        },
        approvalTimeoutValue: {
          type: DataTypes.STRING(8),
          allowNull: true,
          defaultValue: null,
          comment: "Approval 超时默认结果",
        },
        askTimeout: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
          comment: "Ask 等待超时（秒）",
        },
        askTimeoutMessage: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "Ask 超时抛回 LLM 的错误信息",
        },
        intentModel: {
          type: DataTypes.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: "意图识别模型 UUID",
        },
        intentPrompt: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "自定义意图过滤 prompt",
        },
        intentThreshold: {
          type: DataTypes.FLOAT,
          allowNull: true,
          defaultValue: null,
          comment: "意图识别置信度阈值 (0-1)",
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
        tableName: "session_profile",
        timestamps: false,
        comment: "Session Profile 表（共享配置 + thread + token 统计）",
        indexes: [{ fields: ["autoForSessionId"], unique: true }],
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
          allowNull: false,
          defaultValue: "",
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

    this.usageLogs = sequelize.define(
      "usage_logs",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        date: {
          type: DataTypes.STRING(10),
          allowNull: false,
        },
        timestamp: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        agentId: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "",
        },
        agentName: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "",
        },
        modelId: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "",
        },
        modelName: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "",
        },
        provider: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "",
        },
        channelId: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "",
        },
        sessionId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        profileId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        inputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        outputTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        totalTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        cacheCreationTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        cacheReadTokens: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
      },
      {
        tableName: "usage_logs",
        timestamps: false,
        indexes: [
          { fields: ["date"] },
          { fields: ["agentId"] },
          { fields: ["modelId"] },
        ],
      },
    );

    this.heartbeat = sequelize.define(
      "heartbeat",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          comment: "自增ID",
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "显示名称",
        },
        intervalMinutes: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 30,
          comment: "执行间隔（分钟）",
        },
        promptFile: {
          type: DataTypes.STRING(512),
          allowNull: false,
          defaultValue: "",
          comment: "prompt 文件路径",
        },
        target: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          comment: "目标 channel_session.id",
        },
        enabled: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
          comment: "是否启用",
        },
        activeHoursStart: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
          comment: "活跃开始小时 0-23",
        },
        activeHoursEnd: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
          comment: "活跃结束小时 0-23",
        },
        activeHoursTimezone: {
          type: DataTypes.STRING(64),
          allowNull: true,
          defaultValue: null,
          comment: "活跃时段时区",
        },
        lastRun: {
          type: DataTypes.BIGINT,
          allowNull: true,
          defaultValue: null,
          comment: "上次执行时间戳(ms)",
        },
        createdAt: {
          type: DataTypes.BIGINT,
          allowNull: false,
          defaultValue: 0,
          comment: "创建时间戳(ms)",
        },
      },
      {
        tableName: "heartbeat",
        timestamps: false,
        comment: "心跳任务表",
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
      await this.sessionProfile.sync({ alter });
      await this.channelSession.sync({ alter });
      await this.scheduler.sync({ alter });
      await this.usageLogs.sync({ alter });
      await this.heartbeat.sync({ alter });

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

  /** tid = String(profile.id)，token 统计直接在 profile 表 */
  async loadThreadUsages(channelThreadIds: string[]): Promise<Record<string, ThreadUsage>> {
    const result: Record<string, ThreadUsage> = {};
    const pick = (r: any): ThreadUsage => ({
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, totalTokens: r.totalTokens,
      lastInputTokens: r.lastInputTokens, lastOutputTokens: r.lastOutputTokens, lastTotalTokens: r.lastTotalTokens,
    });
    for (const tid of channelThreadIds) {
      const profileId = parseInt(tid, 10);
      if (isNaN(profileId)) continue;
      const row = await this.findByPk<SessionProfileRow>(this.sessionProfile, profileId);
      if (row) result[tid] = pick(row);
    }
    return result;
  }
}
export const database = new Database();

export async function getChannelSession(id: number | string | undefined | null, throwIfNotFound?: boolean): Promise<ChannelSessionRow | null> {
  if (id == null) {
    if (throwIfNotFound) throw new Error('ChannelSession id is required');
    return null;
  }
  const pk = typeof id === 'string' ? parseInt(id) : id;
  if (isNaN(pk)) {
    if (throwIfNotFound) throw new Error(`Invalid ChannelSession id: ${id}`);
    logger.warn(`getChannelSession: invalid id "${id}"`);
    return null;
  }
  const row = await database.findByPk<ChannelSessionRow>(database.channelSession, pk);
  if (!row) {
    if (throwIfNotFound) throw new Error(`ChannelSession not found: ${pk}`);
    logger.warn(`getChannelSession: id=${pk} not found`);
  }
  return row;
}

export async function getSessionProfile(id: number): Promise<SessionProfileRow | null> {
  if (id <= 0) return null;
  return database.findByPk<SessionProfileRow>(database.sessionProfile, id);
}

/**
 * 确保 (channelId, sessionId) 对应的 ChannelSession 存在并关联 auto profile。
 * - findOrCreate session（按 channelId + sessionId）
 * - 已存在时按需更新 sessionData 中的字段（autoSessionName/avatar/sessionName 等）
 * - 自动建/找到 auto profile（已有 profile 不会被覆盖）
 *
 * 同一个入口覆盖三类调用：
 * - channel plugin doInitSession: 仅传 autoSessionName/avatar
 * - admin 新建 web session: 传 sessionName，初始配置由调用方在返回后 update profile
 * - ws 收消息时 ensure: 仅传 (channelId, sessionId)
 */
export async function ensureChannelSession(
  channelId: string,
  sessionId: string,
  opts?: {
    sessionName?: string;
    autoSessionName?: string | null;
    sessionAvatar?: string;
  },
): Promise<{ session: ChannelSessionRow; profile: SessionProfileRow; created: boolean }> {
  const now = Date.now();
  const sessionData: Record<string, any> = {};
  if (opts?.autoSessionName != null) sessionData.autoSessionName = opts.autoSessionName;
  if (opts?.sessionAvatar !== undefined) sessionData.avatar = opts.sessionAvatar;

  const [session, sessionCreated] = await database.findOrCreate<ChannelSessionRow>(database.channelSession, {
    where: { channelId, sessionId },
    defaults: { ...sessionData, sessionName: opts?.sessionName ?? '', profileId: 0, createdAt: now },
  });

  if (!sessionCreated) {
    // 已存在 session：仅更新与传入 sessionData 不同的字段（避免无谓写）
    const changed: Record<string, any> = {};
    for (const k of Object.keys(sessionData)) {
      if ((session as any)[k] !== sessionData[k]) changed[k] = sessionData[k];
    }
    if (Object.keys(changed).length > 0) {
      await database.update(database.channelSession, changed, { where: { channelId, sessionId } });
      Object.assign(session as any, changed);
    }
  }

  let profile = await getSessionProfile((session as any).profileId);
  if (!profile) {
    profile = await database.create<SessionProfileRow>(database.sessionProfile, {
      name: '',
      autoForSessionId: (session as any).id,
      createdAt: now,
    });
    await database.update(database.channelSession, { profileId: (profile as any).id }, { where: { id: (session as any).id } });
    (session as any).profileId = (profile as any).id;
  }

  return { session: session as any, profile: profile!, created: sessionCreated };
}

/** 4 级回退后简化为 2 层：profile.field ?? channel.field ?? hardcoded */
export interface EffectiveSessionResolved {
  agentId: string;
  saver: string;
  threadKey: string;
  memories: string[];
  wikis: string[];
  workPath?: string;
  streamVerbose?: boolean;
  autoApproveAllTools?: boolean;
  approvalTimeout?: number;
  approvalTimeoutValue?: ApprovalTimeoutValue;
  askTimeout?: number;
  askTimeoutMessage?: string;
  intentModel?: string;
  intentPrompt?: string;
  intentThreshold?: number;
}

export interface EffectiveSession {
  session: ChannelSessionRow;
  profile: SessionProfileRow;
  resolved: EffectiveSessionResolved;
}

/** 加载 session + 它指向的 profile + channel 默认，合并出有效配置（profile.field ?? channel.field） */
export async function getEffectiveSession(id: number | string, throwIfNotFound: true): Promise<EffectiveSession>;
export async function getEffectiveSession(id: number | string): Promise<EffectiveSession | undefined>;
export async function getEffectiveSession(
  id: number | string,
  throwIfNotFound?: boolean,
): Promise<EffectiveSession | undefined> {
  const session = await getChannelSession(id, throwIfNotFound);
  if (!session) return undefined;
  // session 创建路径（ensureChannelSession）保证 profileId > 0；找不到 profile 视为数据异常
  const profile = await getSessionProfile(session.profileId);
  if (!profile) throw new Error(`SessionProfile not found: session.id=${session.id}, profileId=${session.profileId}`);
  const channel = config.getChannel(session.channelId);

  const useChannelMemories = profile.memories != null ? !!profile.useChannelMemories : false;
  const useChannelWikis = profile.wikis != null ? !!profile.useChannelWikis : false;
  const ownMems = profile.memories != null ? parseMemories(profile.memories) : [];
  const ownWikis = profile.wikis != null ? parseMemories(profile.wikis) : [];

  const resolved: EffectiveSessionResolved = {
    agentId: profile.agentId ?? channel?.agent ?? '',
    saver: profile.saver ?? channel?.saver ?? '',
    threadKey: String(profile.id),
    memories: useChannelMemories ? [...(channel?.memories ?? []), ...ownMems] : ownMems,
    wikis: useChannelWikis ? [...(channel?.wikis ?? []), ...ownWikis] : ownWikis,
    workPath: profile.workPath ?? channel?.workPath ?? undefined,
    streamVerbose: profile.streamVerbose ?? channel?.streamVerbose ?? undefined,
    autoApproveAllTools: profile.autoApproveAllTools ?? channel?.autoApproveAllTools ?? undefined,
    approvalTimeout: profile.approvalTimeout ?? channel?.approvalTimeout ?? undefined,
    approvalTimeoutValue: profile.approvalTimeoutValue ?? channel?.approvalTimeoutValue ?? undefined,
    askTimeout: profile.askTimeout ?? channel?.askTimeout ?? undefined,
    askTimeoutMessage: profile.askTimeoutMessage ?? channel?.askTimeoutMessage ?? undefined,
    intentModel: profile.intentModel ?? channel?.intentModel ?? undefined,
    intentPrompt: profile.intentPrompt ?? channel?.intentPrompt ?? undefined,
    intentThreshold: profile.intentThreshold ?? channel?.intentThreshold ?? undefined,
  };

  return { session, profile, resolved };
}
