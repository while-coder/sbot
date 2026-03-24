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
  name: string;
  expr: string;                    // cron 表达式，如 "0 9 * * *"
  type: SchedulerType | null;        // 任务类型
  message: string;                 // 消息文本
  targetId: string | null;         // channel_session.id (string) | sessionId | workPath（按 type 区分）
  lastRun: number | null;          // 上次执行时间戳
  nextRun: number | null;          // 下次预计执行时间戳
  runCount: number;                // 已执行次数
  maxRuns: number;                 // 最大执行次数（0 表示不限制）
};

export type StateRow = {
  key: string;
  value: string;
};

export type ChannelUserRow = {
  id: number;
  channel: string;  // 频道唯一ID
  userid: string;   // 用户唯一ID
  username: string; // 用户名字
  avatar: string;   // 用户头像
  userinfo: string; // 用户信息
  
};

export type ChannelSessionRow = {
  id: number;
  channel: string;   // 频道唯一ID
  sessionId: string; // 会话唯一ID
  name: string;      // 会话名称
  avatar: string;    // 会话头像
  agentId: string | null;   // Agent UUID
  memoryId: string | null;  // Memory UUID
  workPath: string | null;  // 工作目录路径
};

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
        userid: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "用户ID",
        },
        username: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "用户名",
        },
        userinfo: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: "",
          comment: "用户信息JSON",
        },
        channel: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: "",
          comment: "频道唯一ID",
        },
        avatar: {
          type: DataTypes.STRING(512),
          allowNull: false,
          defaultValue: "",
          comment: "用户头像URL",
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
        channel: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: "",
          comment: "频道唯一ID",
        },
        sessionId: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: "",
          comment: "Lark chat_id",
        },
        name: {
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
        memoryId: {
          type: DataTypes.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: "Memory UUID",
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
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "",
          comment: "计时器名称",
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

  async sync() {
    try {
      await this.wait();
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

      await this.state.update({ value: DBVersion }, { where: { key: DBVersionName } });
      logger.info("Database schema sync completed");
    } finally {
      this.running = false;
    }
  }

  async findAll<T>(db: ModelStatic<any>, options?: FindOptions): Promise<T[]> {
    try {
      await this.wait();
      return await db.findAll(options);
    } finally {
      this.running = false;
    }
  }

  // 返回值 [返回数据,是否创建了新数据]
  async findOrCreate<T>(db: ModelStatic<any>, options: any): Promise<[T, boolean]> {
    try {
      await this.wait();
      return await db.findOrCreate(options);
    } finally {
      this.running = false;
    }
  }

  // 返回值 数据  find by primary key
  async findByPk<T>(db: ModelStatic<any>, key: any): Promise<T | null> {
    try {
      await this.wait();
      return await db.findByPk(key);
    } finally {
      this.running = false;
    }
  }

  /// 返回值 数据
  async findOne<T>(db: ModelStatic<any>, options?: FindOptions): Promise<T | null> {
    try {
      await this.wait();
      return await db.findOne(options);
    } finally {
      this.running = false;
    }
  }

  // 返回值 创建的数据
  async create<T>(db: ModelStatic<any>, value: any): Promise<T> {
    try {
      await this.wait();
      return await db.create(value);
    } finally {
      this.running = false;
    }
  }

  async count(db: ModelStatic<any>, options?: FindOptions) {
    try {
      await this.wait();
      return await db.count(options);
    } finally {
      this.running = false;
    }
  }

  // 返回值,只有一个值的数组 [更新行数]
  async update(db: ModelStatic<any>, value: any, options: UpdateOptions<any>) {
    try {
      await this.wait();
      return await db.update(value, options);
    } finally {
      this.running = false;
    }
  }

  // 返回值 [返回数据,是否创建了新数据]
  async upsert<T>(db: ModelStatic<any>, value: any, options?: any): Promise<[T, boolean | null]> {
    try {
      await this.wait();
      return await db.upsert(value, options);
    } finally {
      this.running = false;
    }
  }

  async destroy(db: ModelStatic<any>, options?: any) {
    try {
      await this.wait();
      await db.destroy(options);
    } finally {
      this.running = false;
    }
  }

  async query(sql: string, options?: any) {
    try {
      await this.wait();
      return await this.sequelize.query(sql, options);
    } finally {
      this.running = false;
    }
  }
}
export const database = new Database();
