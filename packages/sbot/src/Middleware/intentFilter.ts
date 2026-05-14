import type { Middleware } from "./MiddlewarePipeline";
import type { MessageContext } from "./types";
import { getChannelSession } from "../Core/Database";
import { config } from "../Core/Config";
import { classifyIntent } from "../Processing/classifyIntent";

export const intentFilterMiddleware: Middleware<MessageContext> = async (ctx, next) => {
    if (ctx.args.mentionBot) return next();

    const dbSession = await getChannelSession(ctx.args.dbSessionId);
    const channel = ctx.args.channelId ? config.getChannel(ctx.args.channelId) : undefined;
    const intentModel = dbSession?.intentModel != null ? dbSession.intentModel : channel?.intentModel;
    if (!intentModel) return next();

    const intentPrompt = dbSession?.intentPrompt != null ? dbSession.intentPrompt : (channel?.intentPrompt ?? null);
    const intentThreshold = dbSession?.intentThreshold != null ? dbSession.intentThreshold : (channel?.intentThreshold ?? 0.7);

    if (await classifyIntent(ctx.query, intentModel, intentPrompt, intentThreshold, ctx.threadId)) {
        return next();
    }
    ctx.filtered = true;
};
