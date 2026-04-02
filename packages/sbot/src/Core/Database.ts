import { DataTypes, type FindOptions, type ModelStatic, type UpdateOptions, Sequelize } from "sequelize";
import { sleep } from "scorpio.ai";
import { config } from "./Config";
import { LoggerService } from "./LoggerService";

const logger = LoggerService.getLogger("Database.ts");
const DBVersionName = "db_version";
const DBVersion: string = config.pkg.version;
export type MessageRow = {
  id: string;
  expireTime: number;
};

export enum SchedulerType {
  Channel   = "channel",    // Lark 频道模式（channel_session）
  Session   = "session",    // 会话模式（sessionId）
  Directory = "directory",  // 目录模式（workPath）
}

export type SchedulerRow = {
  id: number;
  expr: string;                    // cron 表达式，如 "0 9 * * *"
  type: SchedulerType | null;        // 任务类型
  message: string;                 // 消息文本
  targetId: string | null;         // channel_session.id (string) | sessionId | workPath（按 type 区分）
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

export type ChannelSessionRow = {
  id: number;
  channelId: string;   // 频道唯一ID
  sessionId: string;   // 会话唯一ID
  sessionName: string; // 会话名称
  avatar: string;      // 会话头像
  agentId: string | null;       // Agent UUID
  memories: string | null;      // Memory UUID 列表（JSON 字符串，使用 parseMemories() 解析）
  useChannelMemories: boolean;  // 是否使用渠道级记忆
  workPath: string | null;      // 工作目录路径
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
          comment: "Agent UUID",
        },
        memories: {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null,
          comment: "Memory UUID 列表（JSON 字符串，读取时用 parseMemories() 解析）",
        },
        useChannelMemories: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          comment: "是否使用渠道级记忆",
        },
        workPath: {
          type: DataTypes.STRING(1024),
          allowNull: true,
          defaultValue: null,
          comment: "工作目录路径",
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
        type: {
          type: DataTypes.STRING(64),
          allowNull: true,
          defaultValue: null,
          comment: "任务类型标识",
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
          comment: "目标 ID（channel_session.id | sessionId | workPath，按 type 区分）",
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
      await this.migrateSchedulerAutoIncrement();

      await this.state.update({ value: DBVersion }, { where: { key: DBVersionName } });
      logger.info("Database schema sync completed");
    });
  }

  /**
   * 确保 scheduler 表使用 AUTOINCREMENT，保证 id 严格单调递增、清空表后不重置。
   * SQLite 的 INTEGER PRIMARY KEY 本身不保证不重用，必须显式声明 AUTOINCREMENT。
   * 若旧表缺少该关键字则进行原地迁移（重命名 → 新建 → 复制 → 删旧）。
   */
  private async migrateSchedulerAutoIncrement(): Promise<void> {
    const [rows] = await this.sequelize.query(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduler'`
    ) as [any[], unknown];

    const existingSql: string = rows[0]?.sql ?? '';
    if (existingSql.toUpperCase().includes('AUTOINCREMENT')) return;

    logger.info('Migrating scheduler table to add AUTOINCREMENT...');
    await this.sequelize.query(`ALTER TABLE "scheduler" RENAME TO "scheduler_old"`);
    await this.sequelize.query(`
      CREATE TABLE "scheduler" (
        "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
        "type"     VARCHAR(64),
        "expr"     TEXT    NOT NULL DEFAULT '',
        "message"  TEXT    NOT NULL DEFAULT '',
        "targetId" TEXT,
        "lastRun"  BIGINT,
        "runCount" INTEGER NOT NULL DEFAULT 0,
        "nextRun"  BIGINT,
        "maxRuns"  INTEGER NOT NULL DEFAULT 0,
        "disabled" TINYINT NOT NULL DEFAULT 0
      )
    `);
    await this.sequelize.query(`
      INSERT INTO "scheduler" ("id","type","expr","message","targetId","lastRun","runCount","nextRun","maxRuns")
      SELECT "id","type","expr","message","targetId","lastRun","runCount","nextRun","maxRuns"
      FROM "scheduler_old"
    `);
    await this.sequelize.query(`DROP TABLE "scheduler_old"`);

    // 将 sqlite_sequence 的计数同步到当前最大 id，保证后续插入严格递增
    const [maxRows] = await this.sequelize.query(
      `SELECT COALESCE(MAX("id"), 0) AS maxId FROM "scheduler"`
    ) as [any[], unknown];
    const maxId: number = maxRows[0]?.maxId ?? 0;
    // sqlite_sequence may already have a row for 'scheduler'; update or insert accordingly
    const [seqRows] = await this.sequelize.query(
      `SELECT seq FROM sqlite_sequence WHERE name = 'scheduler'`
    ) as [any[], unknown];
    if (seqRows.length > 0) {
      await this.sequelize.query(
        `UPDATE sqlite_sequence SET seq = MAX(seq, ${maxId}) WHERE name = 'scheduler'`
      );
    } else {
      await this.sequelize.query(
        `INSERT INTO sqlite_sequence (name, seq) VALUES ('scheduler', ${maxId})`
      );
    }
    logger.info(`Scheduler table migration completed, sequence set to ${maxId}`);
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
}
export const database = new Database();
