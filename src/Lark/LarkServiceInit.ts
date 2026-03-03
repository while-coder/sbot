import { larkService, LarkActionArgs, LarkMessageArgs } from "winning.ai";
import { database } from "../Database";
import { Util } from "weimingcommons";
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
    const now = Util.NowDate;
    if (now < checkTime) return;
    checkTime = now + CheckInterval;
    await database.destroy(database.message, {
        where: { expireTime: { [Op.lt]: now } },
    });
}

async function filterEvent(eventId: string): Promise<boolean> {
    await clearExpiredMessage();
    if ((await database.count(database.message, { where: { id: eventId } })) > 0) return false;
    await database.create(database.message, { id: eventId, expireTime: Util.NowDate + ExpireTime });
    return true;
}

export function hasLarkConfig(): boolean {
    const lark = config.settings.lark;
    return !!(lark?.appId?.trim() && lark?.appSecret?.trim());
}

export async function startLarkService() {
    await larkService.start({
        appId: config.settings.lark!.appId!,
        appSecret: config.settings.lark!.appSecret!,
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
    });
    logger.info("Lark 服务启动成功");
}

export async function restartLarkService() {
    if (!hasLarkConfig()) {
        larkService.stop();
        logger.info("Lark 配置未填写，跳过启动");
        return;
    }
    await startLarkService();
    logger.info("Lark 服务重启成功");
}
