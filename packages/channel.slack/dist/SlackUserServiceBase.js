"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackUserServiceBase = exports.ToolCallStatus = void 0;
const SlackChatProvider_1 = require("./SlackChatProvider");
const scorpio_ai_1 = require("scorpio.ai");
const scorpio_ai_2 = require("scorpio.ai");
const getLogger = () => scorpio_ai_2.GlobalLoggerService.getLogger("SlackUserServiceBase.ts");
var ToolCallStatus;
(function (ToolCallStatus) {
    ToolCallStatus["None"] = "none";
    ToolCallStatus["Wait"] = "wait";
    ToolCallStatus["Allow"] = "allow";
    ToolCallStatus["AlwaysArgs"] = "alwaysArgs";
    ToolCallStatus["AlwaysTool"] = "alwaysTool";
    ToolCallStatus["Deny"] = "deny";
})(ToolCallStatus || (exports.ToolCallStatus = ToolCallStatus = {}));
class SlackUserServiceBase extends scorpio_ai_1.UserServiceBase {
    provider;
    slackService;
    toolCall = { id: undefined, status: ToolCallStatus.None };
    askState = { id: undefined, status: "wait", questionMap: {} };
    async startProcessMessage(query, args) {
        const { slackService, channel, ts, threadTs } = args;
        this.slackService = slackService;
        this.provider = await new SlackChatProvider_1.SlackChatProvider(slackService).init(channel, ts, threadTs, query);
        return `Slack channel:${channel} ts:${ts}`;
    }
    async processMessageError(e) {
        if (this.provider) {
            await this.provider.setMessage(`生成回复时出错: ${e.message}`);
        }
    }
    async onAgentStreamMessage(message) {
        await this.provider?.setStreamMessage(message.content || "");
    }
    async onAgentMessage(message) {
        this.provider?.resetStreamMessage();
        await this.provider?.addAIMessage(message);
    }
    buildApprovalBlocks(toolName, remainSec) {
        const makeButton = (text, actionId, style) => ({
            type: "button",
            text: { type: "plain_text", text },
            action_id: actionId,
            value: JSON.stringify({ id: this.toolCall.id, approval: actionId }),
            ...(style ? { style } : {}),
        });
        return [
            {
                type: "actions",
                block_id: "toolCallActions",
                elements: [
                    makeButton(`允许 ${toolName}`, ToolCallStatus.Allow, "primary"),
                    makeButton(`总是允许 ${toolName} (相同参数)`, ToolCallStatus.AlwaysArgs),
                    makeButton(`总是允许 ${toolName} (所有参数)`, ToolCallStatus.AlwaysTool),
                    makeButton(`拒绝 (${remainSec}秒)`, ToolCallStatus.Deny, "danger"),
                ],
            },
        ];
    }
    async executeAgentTool(toolCall) {
        this.toolCall.id = toolCall.id;
        this.toolCall.status = ToolCallStatus.Wait;
        try {
            const timeout = 30 * 1000;
            const end = (0, scorpio_ai_1.NowDate)() + timeout;
            let lastSend = 0;
            while (this.toolCall.status === ToolCallStatus.Wait) {
                if ((0, scorpio_ai_1.NowDate)() - lastSend > 300) {
                    lastSend = (0, scorpio_ai_1.NowDate)();
                    const remainSec = Math.floor((end - (0, scorpio_ai_1.NowDate)()) / 1000);
                    await this.provider?.setApprovalBlocks(this.buildApprovalBlocks(toolCall.name, remainSec));
                }
                await (0, scorpio_ai_1.sleep)(10);
                if ((0, scorpio_ai_1.NowDate)() > end) {
                    this.toolCall.status = ToolCallStatus.Deny;
                    break;
                }
            }
            await this.provider?.clearApprovalBlocks();
            const statusToApproval = {
                [ToolCallStatus.Allow]: scorpio_ai_1.ToolApproval.Allow,
                [ToolCallStatus.AlwaysArgs]: scorpio_ai_1.ToolApproval.AlwaysArgs,
                [ToolCallStatus.AlwaysTool]: scorpio_ai_1.ToolApproval.AlwaysTool,
            };
            return statusToApproval[this.toolCall.status] ?? scorpio_ai_1.ToolApproval.Deny;
        }
        finally {
            this.toolCall.id = undefined;
            this.toolCall.status = ToolCallStatus.None;
        }
    }
    async ask(params) {
        const askId = `ask_${Date.now()}`;
        const questionMap = {};
        const inputBlocks = [];
        if (params.title) {
            inputBlocks.push({
                type: "section",
                text: { type: "mrkdwn", text: `*${params.title}*` },
            });
        }
        for (let i = 0; i < params.questions.length; i++) {
            const q = params.questions[i];
            const blockId = `q_${i}`;
            questionMap[blockId] = q.label;
            if (q.type === "radio") {
                inputBlocks.push({
                    type: "input",
                    block_id: blockId,
                    label: { type: "plain_text", text: q.label },
                    element: {
                        type: "static_select",
                        action_id: blockId,
                        placeholder: { type: "plain_text", text: "选择..." },
                        options: q.options.map((o) => ({
                            text: { type: "plain_text", text: o },
                            value: o,
                        })),
                    },
                });
            }
            else if (q.type === "checkbox") {
                inputBlocks.push({
                    type: "input",
                    block_id: blockId,
                    label: { type: "plain_text", text: q.label },
                    element: {
                        type: "multi_static_select",
                        action_id: blockId,
                        placeholder: { type: "plain_text", text: "选择..." },
                        options: q.options.map((o) => ({
                            text: { type: "plain_text", text: o },
                            value: o,
                        })),
                    },
                });
            }
            else {
                inputBlocks.push({
                    type: "input",
                    block_id: blockId,
                    label: { type: "plain_text", text: q.label },
                    element: {
                        type: "plain_text_input",
                        action_id: blockId,
                        ...(q.placeholder
                            ? { placeholder: { type: "plain_text", text: q.placeholder } }
                            : {}),
                    },
                });
            }
        }
        inputBlocks.push({
            type: "actions",
            block_id: "askSubmit",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: "提交" },
                    style: "primary",
                    action_id: `ask_submit_${askId}`,
                    value: JSON.stringify({ id: askId }),
                },
            ],
        });
        this.askState = { id: askId, status: "wait", questionMap };
        await this.provider?.setAskBlocks(inputBlocks);
        const end = (0, scorpio_ai_1.NowDate)() + 5 * 60 * 1000;
        while (this.askState.status === "wait") {
            await (0, scorpio_ai_1.sleep)(10);
            if ((0, scorpio_ai_1.NowDate)() > end) {
                this.askState.status = "timeout";
                break;
            }
        }
        await this.provider?.clearAskBlocks();
        const { status, response } = this.askState;
        this.askState = { id: undefined, status: "wait", questionMap: {} };
        if (status !== "done" || !response)
            throw new Error("User did not answer within the allotted time");
        return response;
    }
    async onTriggerAction(args) {
        const { actionId, value } = args;
        if (actionId === ToolCallStatus.Allow ||
            actionId === ToolCallStatus.AlwaysArgs ||
            actionId === ToolCallStatus.AlwaysTool ||
            actionId === ToolCallStatus.Deny) {
            if (value?.id === this.toolCall.id) {
                this.toolCall.status = actionId;
            }
            return;
        }
        if (actionId.startsWith("ask_submit_")) {
            if (value?.id !== this.askState.id)
                return;
            if (value?.answers) {
                const response = {};
                for (const [blockId, label] of Object.entries(this.askState.questionMap)) {
                    const val = value.answers[blockId];
                    if (val !== undefined)
                        response[label] = val;
                }
                this.askState.response = response;
                this.askState.status = "done";
            }
            return;
        }
        getLogger()?.warn(`Unhandled Slack action: ${actionId}`);
    }
}
exports.SlackUserServiceBase = SlackUserServiceBase;
//# sourceMappingURL=SlackUserServiceBase.js.map