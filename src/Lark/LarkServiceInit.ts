import { channelManager } from "../ChannelManager";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("LarkServiceInit.ts");

export function hasLarkConfig(): boolean {
    return channelManager.getLarkChannels().length > 0;
}

export async function startLarkService(): Promise<boolean> {
    await channelManager.init();
    return hasLarkConfig();
}

export async function restartLarkService(): Promise<void> {
    await channelManager.reload();
    logger.info("Lark 服务重启完成");
}
