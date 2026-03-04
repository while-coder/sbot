import { LarkService, LarkActionArgs, LarkMessageArgs, LarkUserIdType } from "winning.ai";
import { database } from "../Database";
import { NowDate } from "../Utils";
import { Op } from "sequelize";
import { userService } from "../UserService/UserService";
import { LoggerService } from "../LoggerService";
import { config } from "../Config";

const logger = LoggerService.getLogger("LarkServiceInit.ts");

const HourMilliseconds = 1000 * 60 * 60;
const CheckInterval = HourMilliseconds;
const ExpireTime = HourMilliseconds * 24 * 3;

let checkTime = 0;

async function clearExpiredMessage() {
    const now = NowDate();
    if (now < checkTime) return;
    checkTime = now + CheckInterval;
    await database.destroy(database.message, {
        where: { expireTime: { [Op.lt]: now } },
    });
}

async function filterEvent(eventId: string): Promise<boolean> {
    await clearExpiredMessage();
    if ((await database.count(database.message, { where: { id: eventId } })) > 0) return false;
    await database.create(database.message, { id: eventId, expireTime: NowDate() + ExpireTime });
    return true;
}

export function hasLarkConfig(): boolean {
    const lark = config.settings.lark;
    return !!(lark?.appId?.trim() && lark?.appSecret?.trim());
}

export let globalLarkService:LarkService|undefined;
export async function startLarkService() {
    if (!hasLarkConfig()) return false
    globalLarkService = new LarkService({
        appId: config.settings.lark!.appId!,
        appSecret: config.settings.lark!.appSecret!,
        userIdType: LarkUserIdType.UnionId,
        filterEvent,
        onRecevieMessage: async (userId: string, userInfo: any, args: LarkMessageArgs, query: string) => {
            if (userId) {
                await database.create(database.user, {
                    userid: userId,
                    username: userInfo?.name ?? "",
                    userinfo: JSON.stringify(userInfo ?? {}),
                    usertype: "lark",
                });
            }
            await userService.onReceiveLarkMessage(args, userInfo, query);
        },
        onTriggerAction: async (_userId: string, _userInfo: any, args: LarkActionArgs) => {
            await userService.lark.onTriggerAction(args.chat_id, args.code, args.data, args.form_value);
        },
    })
    await globalLarkService.registerEventDispatcher()
    logger.info("Lark 服务启动成功");
}

export async function restartLarkService() {
    if (!hasLarkConfig()) {
        globalLarkService?.dispose();
        globalLarkService = undefined
        logger.info("Lark 配置未填写，跳过启动");
        return;
    }
    await startLarkService();
    logger.info("Lark 服务重启成功");
}
