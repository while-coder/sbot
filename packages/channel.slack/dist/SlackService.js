"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackService = void 0;
const bolt_1 = require("@slack/bolt");
class SlackService {
    app;
    logger;
    filterEvent;
    onReceiveMessage;
    onTriggerAction;
    constructor(options) {
        this.logger = options.logger;
        this.filterEvent = options.filterEvent;
        this.onReceiveMessage = options.onReceiveMessage;
        this.onTriggerAction = options.onTriggerAction;
        this.app = new bolt_1.App({
            token: options.botToken,
            appToken: options.appToken,
            socketMode: true,
        });
    }
    dispose() {
        this.app.stop().catch(() => { });
    }
    async sendMessage(channel, text, threadTs) {
        const result = await this.app.client.chat.postMessage({
            channel,
            text,
            ...(threadTs ? { thread_ts: threadTs } : {}),
        });
        if (!result.ok || !result.ts || !result.channel) {
            throw new Error(`Slack postMessage failed: ${result.error}`);
        }
        return { ts: result.ts, channel: result.channel };
    }
    async updateMessage(channel, ts, text, blocks) {
        await this.app.client.chat.update({
            channel,
            ts,
            text,
            ...(blocks ? { blocks } : {}),
        });
    }
    async getUserInfo(userId) {
        try {
            const result = await this.app.client.users.info({ user: userId });
            return result.user ?? {};
        }
        catch (e) {
            this.logger?.error(`getUserInfo error: ${e.message}`);
            return {};
        }
    }
    async registerEventHandlers() {
        this.app.message(async ({ message, say: _say }) => {
            try {
                const msg = message;
                if (msg.subtype || msg.bot_id || !msg.text)
                    return;
                const eventId = msg.event_ts ?? msg.ts;
                if (!await this.filterEvent(eventId))
                    return;
                const userId = msg.user;
                const channel = msg.channel;
                const threadTs = msg.thread_ts;
                const ts = msg.ts;
                const query = msg.text
                    .replace(/<@[A-Z0-9]+>/g, "")
                    .trim();
                if (!query)
                    return;
                const userInfo = await this.getUserInfo(userId);
                await this.onReceiveMessage(userId, userInfo, {
                    slackService: this,
                    channel,
                    ts,
                    threadTs,
                }, query);
            }
            catch (e) {
                this.logger?.error(`Slack message handler error: ${e.stack}`);
            }
        });
        this.app.action(/.*/, async ({ action, body, ack }) => {
            await ack();
            try {
                const act = action;
                const userId = body.user?.id;
                const channel = body.channel?.id ?? body.container?.channel_id ?? "";
                const messageTs = body.message?.ts ?? "";
                // Extract input block values from state (for Ask forms)
                const stateValues = body.state?.values ?? {};
                const answers = {};
                for (const [blockId, blockState] of Object.entries(stateValues)) {
                    const blockEntry = blockState;
                    for (const [, elementState] of Object.entries(blockEntry)) {
                        const el = elementState;
                        if (el.type === "plain_text_input") {
                            answers[blockId] = el.value;
                        }
                        else if (el.type === "static_select") {
                            answers[blockId] = el.selected_option?.value;
                        }
                        else if (el.type === "multi_static_select") {
                            answers[blockId] = el.selected_options?.map((o) => o.value) ?? [];
                        }
                    }
                }
                let value;
                try {
                    value = act.value ? JSON.parse(act.value) : undefined;
                }
                catch {
                    value = act.value;
                }
                if (value && act.action_id?.startsWith("ask_submit_")) {
                    value.answers = answers;
                }
                await this.onTriggerAction(userId, {
                    channel,
                    messageTs,
                    actionId: act.action_id,
                    value,
                });
            }
            catch (e) {
                this.logger?.error(`Slack action handler error: ${e.stack}`);
            }
        });
        await this.app.start();
        this.logger?.info("Slack Socket Mode connected");
    }
}
exports.SlackService = SlackService;
//# sourceMappingURL=SlackService.js.map