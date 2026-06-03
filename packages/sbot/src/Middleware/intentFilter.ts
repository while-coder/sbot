import type { Middleware } from "./MiddlewarePipeline";
import type { MessageContext } from "./types";
import { channelDataService } from "../Session/ChannelDataService";
import { classifyIntent } from "../Processing/classifyIntent";

export const intentFilterMiddleware: Middleware<MessageContext> = async (ctx, next) => {
    if (ctx.args.mentionBot) return next();
    if (ctx.args.dbSessionId == null) return next();

    const eff = await channelDataService.getEffective(ctx.args.dbSessionId);
    if (!eff) return next();
    const intentModel = eff.resolved.intentModel;
    if (!intentModel) return next();

    const intentPrompt = eff.resolved.intentPrompt ?? null;
    const intentThreshold = eff.resolved.intentThreshold ?? 0.7;

    if (await classifyIntent(ctx.query, intentModel, intentPrompt, intentThreshold, ctx.threadId)) {
        return next();
    }
    ctx.filtered = true;
};
