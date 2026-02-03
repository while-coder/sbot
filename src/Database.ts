import log4js from "log4js";
import { DataTypes, type FindOptions, type ModelStatic, type UpdateOptions, Sequelize } from "sequelize";
import { Util } from "weimingcommons";
import { config } from "./Config";

const logger = log4js.getLogger("Database.ts");
const DBVersionName = "db_version";
const DBVersion = '0.0.1'
export type MessageRow = {
  id: string;
  expireTime: number;
};

export type StateRow = {
  key: string;
  value: string;
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

  async init() {
    this.running = false;

    // 获取数据库文件路径
    const dbStorage = config.getConfigPath("database.sqlite");

    this.dbConfig = {
      type: "sqlite",
      storage: dbStorage,
    };

    logger.info(`数据库信息:${JSON.stringify(this.dbConfig)}`);

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
        await Util.sleep(1);
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
      logger.info(`开始刷新数据库结构 alter:${alter} ${data.value} -> ${DBVersion}`);

      await this.message.sync({ alter });

      await this.state.update({ value: DBVersion }, { where: { key: DBVersionName } });
      logger.info("刷新数据库结构完成");
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
