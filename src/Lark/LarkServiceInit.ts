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

export async function startLarkService() {
    await larkService.start({
        appId: config.settings.lark!.appId!,
        appSecret: config.settings.lark!.appSecret!,
        filterEvent,
        onRecevieMessage: async (_userId: string, userInfo: any, args: LarkMessageArgs, query: string) => {
            await userService.onReceiveLarkMessage(args, userInfo, query);
        },
        onTriggerAction: async (_userId: string, _userInfo: any, args: LarkActionArgs) => {
            await userService.lark.onTriggerAction(args.chat_id, args.code, args.data, args.form_value);
        },
    });
    logger.info("Lark 服务启动成功");
}
