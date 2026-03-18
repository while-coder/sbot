"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackChatProvider = void 0;
const scorpio_ai_1 = require("scorpio.ai");
const getLogger = () => scorpio_ai_1.GlobalLoggerService.getLogger("SlackChatProvider.ts");
const UPDATE_INTERVAL_MS = 300;
var ProviderMessageType;
(function (ProviderMessageType) {
    ProviderMessageType["TEXT"] = "text";
    ProviderMessageType["TOOL"] = "tool";
})(ProviderMessageType || (ProviderMessageType = {}));
class SlackChatProvider {
    slackService;
    channel = "";
    ts = "";
    messages = [];
    streamMessage;
    tools = {};
    approvalBlocks;
    askBlocks;
    lastUpdateTime = 0;
    constructor(slackService) {
        this.slackService = slackService;
    }
    async init(channel, incomingTs, threadTs, query) {
        const initialText = query
            ? `${query}\n思考中... / Thinking...`
            : `开始处理...`;
        const replyThreadTs = threadTs ?? incomingTs;
        const sent = await this.slackService.sendMessage(channel, initialText, replyThreadTs);
        this.channel = sent.channel;
        this.ts = sent.ts;
        return this;
    }
    parseMessages2Text(messages) {
        const parts = [];
        for (const msg of messages) {
            if (msg.type === ProviderMessageType.TEXT) {
                parts.push(msg.content);
            }
            else {
                let block = `\`\`\`\n调用: ${msg.name}\n参数:\n${JSON.stringify(msg.args, null, 2)}`;
                if (msg.result) {
                    let escapedResponse = "";
                    const parsed = (0, scorpio_ai_1.parseJson)(msg.response, undefined);
                    if ((0, scorpio_ai_1.isMCPToolResult)(parsed)) {
                        const contentParts = [];
                        for (const c of parsed.content) {
                            if (c.type === scorpio_ai_1.MCPContentType.Text) {
                                contentParts.push(`------${c.type}------\n${c.text}`);
                            }
                            else if (c.type === scorpio_ai_1.MCPContentType.Image) {
                                contentParts.push(`------${c.type}------\n[image:${c.mimeType}]`);
                            }
                            else {
                                contentParts.push(`------${c.type}------\n${JSON.stringify(c)}`);
                            }
                        }
                        escapedResponse = contentParts.join("\n");
                    }
                    else {
                        escapedResponse = String(parsed);
                    }
                    escapedResponse = escapedResponse.replace(/`/g, "\\`");
                    block += `\n返回值:\n${escapedResponse}`;
                }
                else {
                    block += `\n执行中...`;
                }
                block += `\n\`\`\`\n---`;
                parts.push(block);
            }
        }
        return parts.join("\n\n");
    }
    async addAIMessage(message) {
        if (message.type === scorpio_ai_1.MessageChunkType.AI) {
            if (message.content) {
                this.messages.push({ type: ProviderMessageType.TEXT, content: message.content });
            }
            if (message.tool_calls?.length) {
                for (const t of message.tool_calls) {
                    const toolMsg = {
                        type: ProviderMessageType.TOOL,
                        name: t.name,
                        args: t.args,
                    };
                    if (t.id)
                        this.tools[t.id] = toolMsg;
                    this.messages.push(toolMsg);
                }
            }
        }
        else if (message.type === scorpio_ai_1.MessageChunkType.TOOL) {
            const toolMsg = this.tools[message.tool_call_id || ""];
            if (toolMsg) {
                toolMsg.result = true;
                toolMsg.status = message.status;
                toolMsg.response = message.content || "";
            }
        }
        else if (message.type === scorpio_ai_1.MessageChunkType.COMMAND) {
            this.messages.push({ type: ProviderMessageType.TEXT, content: message.content || "" });
        }
        await this.flushUpdate();
    }
    async setMessage(content) {
        this.messages = [{ type: ProviderMessageType.TEXT, content }];
        await this.flushUpdate();
    }
    async setStreamMessage(content) {
        this.streamMessage = { type: ProviderMessageType.TEXT, content };
        await this.throttledUpdate();
    }
    resetStreamMessage() {
        this.streamMessage = undefined;
    }
    async setApprovalBlocks(blocks) {
        this.approvalBlocks = blocks;
        await this.flushUpdate();
    }
    async clearApprovalBlocks() {
        this.approvalBlocks = undefined;
        await this.flushUpdate();
    }
    async setAskBlocks(blocks) {
        this.askBlocks = blocks;
        await this.flushUpdate();
    }
    async clearAskBlocks() {
        this.askBlocks = undefined;
        await this.flushUpdate();
    }
    buildBlocks(text) {
        const blocks = [
            {
                type: "section",
                text: { type: "mrkdwn", text: text || "…" },
            },
        ];
        if (this.approvalBlocks)
            blocks.push(...this.approvalBlocks);
        if (this.askBlocks)
            blocks.push(...this.askBlocks);
        return blocks;
    }
    async throttledUpdate() {
        const now = Date.now();
        if (now - this.lastUpdateTime < UPDATE_INTERVAL_MS)
            return;
        await this.flushUpdate();
    }
    async flushUpdate() {
        if (!this.channel || !this.ts)
            return;
        this.lastUpdateTime = Date.now();
        let msgs = this.messages;
        if (this.streamMessage) {
            msgs = [...this.messages, this.streamMessage];
        }
        const text = this.parseMessages2Text(msgs);
        const blocks = this.buildBlocks(text);
        try {
            await this.slackService.updateMessage(this.channel, this.ts, text, blocks);
        }
        catch (e) {
            getLogger()?.error(`updateMessage error: ${e.message}`, e.stack);
        }
    }
}
exports.SlackChatProvider = SlackChatProvider;
//# sourceMappingURL=SlackChatProvider.js.map